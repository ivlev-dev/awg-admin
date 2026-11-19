package space.ivlev.umbravpn.data.sync

import com.wgtunnel.parser.Config
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeout
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncEvent
import space.ivlev.umbravpn.domain.sync.SyncRemovalReason
import space.ivlev.umbravpn.domain.sync.SyncResult
import timber.log.Timber

class RemoteManagedTunnelSyncService(
    private val accountRepository: AccountRepository,
    private val accountSettingsRepository: AccountSettingsRepository,
    private val session: StateFlow<SessionState>,
    private val managedTunnelRepository: ManagedTunnelRepository,
    private val tunnelRepository: TunnelRepository,
    private val deviceNameProvider: () -> String,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val syncTimeoutMillis: Long = DEFAULT_SYNC_TIMEOUT_MILLIS,
    private val maxParallelDeviceLoads: Int = DEFAULT_MAX_PARALLEL_DEVICE_LOADS,
    private val onSyncFinished: suspend () -> Unit = {},
) : ManagedTunnelSyncService {

    private val mutex = Mutex()
    private val _events = MutableSharedFlow<SyncEvent>(extraBufferCapacity = EVENT_BUFFER_CAPACITY)

    override val events: SharedFlow<SyncEvent> = _events.asSharedFlow()

    override suspend fun sync(): SyncResult = mutex.withLock {
        val result =
            try {
                withTimeout(syncTimeoutMillis) { performSync() }
            } catch (e: TimeoutCancellationException) {
                Timber.w(e, "Managed tunnel sync timed out after $syncTimeoutMillis ms")
                SyncResult.Offline
            } catch (e: SyncAbort) {
                e.result
            }
        runPostSync()
        result
    }

    private suspend fun runPostSync() {
        try {
            onSyncFinished()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "Managed tunnel sync post-processing failed")
        }
    }

    private suspend fun performSync(): SyncResult {
        if (session.value !is SessionState.Active) return SyncResult.NotConfigured
        if (accountSettingsRepository.serverUrl().isBlank()) return SyncResult.NotConfigured

        val snapshot =
            when (val result = accountRepository.bootstrap()) {
                is AccountResult.Failure -> return result.error.toSyncResult()
                is AccountResult.Success -> result.value
            }
        val snapshotDevices = snapshot.devices

        val activeDevices: List<AccountDevice>
        val configs: Map<String, List<DeviceConfig>>
        if (snapshot.devices.isEmpty()) {
            if (accountSettingsRepository.managedProvisioned()) {
                activeDevices = emptyList()
                configs = emptyMap()
            } else {
                val created =
                    when (val result = accountRepository.createDevice(deviceNameProvider())) {
                        is AccountResult.Failure -> return result.error.toSyncResult()
                        is AccountResult.Success -> result.value
                    }
                accountSettingsRepository.setManagedProvisioned(true)
                activeDevices = listOf(created.device)
                configs = mapOf(created.device.id to created.allConfigs)
            }
        } else {
            activeDevices = snapshot.devices.filterNot { it.revoked }
            configs = loadDeviceConfigs(activeDevices)
        }

        if (activeDevices.isNotEmpty()) accountSettingsRepository.setManagedProvisioned(true)

        for (device in activeDevices) {
            for (config in configs[device.id].orEmpty()) {
                try {
                    Config.parseQuickString(config.conf).also { it.validate() }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "Managed tunnel sync: invalid config for device ${device.id}")
                    return SyncResult.Failed(e.message ?: CONFIG_ERROR_MESSAGE)
                }
            }
        }

        val orderedConfigs = activeDevices.associate { device ->
            device.id to orderManagedConfigs(device, configs[device.id].orEmpty())
        }
        val bindings = managedTunnelRepository.getAll()
        val activeDeviceIds = activeDevices.mapTo(mutableSetOf()) { it.id }
        val desiredKeys =
            activeDevices.flatMapTo(mutableSetOf()) { device ->
                orderedConfigs[device.id].orEmpty().mapIndexed { index, config ->
                    bindingKey(device, config, index)
                }
            }
        val desiredInterfaces = desiredKeys.mapTo(mutableSetOf()) { it.deviceId to it.interfaceId }
        val reusableLegacyKeys =
            bindings
                .filter { binding ->
                    binding.deviceId in activeDeviceIds &&
                        binding.peerId.isBlank() &&
                        (binding.interfaceId.isBlank() ||
                            (binding.deviceId to binding.interfaceId) in desiredInterfaces)
                }
                .mapTo(mutableSetOf()) { BindingKey(it.deviceId, it.interfaceId, it.peerId) }

        var removedCount = 0
        val removedNames = mutableListOf<String>()
        val removalReasons = mutableListOf<SyncRemovalReason>()
        for (binding in bindings) {
            val key = BindingKey(binding.deviceId, binding.interfaceId, binding.peerId)
            val desired = key in desiredKeys || key in reusableLegacyKeys
            if (desired) continue
            val tunnel = tunnelRepository.getById(binding.tunnelId)
            removedNames += tunnel?.name ?: binding.deviceName
            removalReasons += removalReason(snapshotDevices, binding.deviceId)
            tunnel?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId, binding.peerId)
            removedCount++
        }

        val remainingTunnels = tunnelRepository.getAll()
        val usedNames = remainingTunnels.mapTo(mutableSetOf()) { it.name }
        var nextPosition = (remainingTunnels.maxOfOrNull { it.position } ?: -1) + 1
        var createdCount = 0
        var updatedCount = 0
        val updatedNames = mutableListOf<String>()
        val matched = mutableSetOf<BindingKey>()
        val consumedTunnelIds = mutableSetOf<Int>()

        for (device in activeDevices) {
            val ordered = orderedConfigs[device.id].orEmpty()
            val deviceBindings = bindings.filter { it.deviceId == device.id }

            ordered.forEachIndexed { index, config ->
                val key = bindingKey(device, config, index)
                if (!matched.add(key)) return@forEachIndexed
                val primary = index == 0

                val parsed =
                    try {
                        Config.parseQuickString(config.conf).also { it.validate() }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Timber.w(e, "Managed tunnel sync: invalid config for device ${device.id}")
                        return SyncResult.Failed(e.message ?: CONFIG_ERROR_MESSAGE)
                    }
                val quickConfig = parsed.asQuickString()
                val desiredName = managedTunnelBaseName(device.name, config, primary)
                val binding =
                    findBinding(
                        deviceBindings = deviceBindings,
                        consumedTunnelIds = consumedTunnelIds,
                        key = key,
                        primary = primary,
                    )
                val existing = binding?.let { tunnelRepository.getById(it.tunnelId) }

                if (binding == null || existing == null) {
                    if (binding != null) {
                        managedTunnelRepository.unbind(
                            binding.deviceId,
                            binding.interfaceId,
                            binding.peerId,
                        )
                        consumedTunnelIds += binding.tunnelId
                    }
                    val imported = TunnelConfig.fromConfig(parsed, device.name)
                    val name = uniqueTunnelName(desiredName, usedNames)
                    tunnelRepository.save(imported.copy(name = name, position = nextPosition++))
                    val saved =
                        tunnelRepository.findByTunnelName(name)
                            ?: return SyncResult.Failed(SAVE_ERROR_MESSAGE)
                    managedTunnelRepository.bind(
                        ManagedTunnel(
                            deviceId = device.id,
                            tunnelId = saved.id,
                            deviceName = device.name,
                            interfaceId = key.interfaceId,
                            endpoint = config.endpoint,
                            revision = config.revision,
                            syncedAt = now(),
                            peerId = key.peerId,
                            label = config.displayLabel,
                        ),
                    )
                    usedNames += name
                    createdCount++
                } else {
                    consumedTunnelIds += binding.tunnelId
                    val name =
                        if (existing.name == desiredName) {
                            existing.name
                        } else {
                            uniqueTunnelName(desiredName, usedNames - existing.name)
                        }
                    val nextQuickConfig =
                        if (binding.revision != config.revision) quickConfig
                        else existing.quickConfig
                    if (name != existing.name || nextQuickConfig != existing.quickConfig) {
                        tunnelRepository.save(
                            existing.copy(name = name, quickConfig = nextQuickConfig),
                        )
                        if (name != existing.name) {
                            usedNames -= existing.name
                            usedNames += name
                        }
                        updatedCount++
                        updatedNames += name
                    }
                    if (binding.interfaceId != key.interfaceId || binding.peerId != key.peerId) {
                        managedTunnelRepository.unbind(
                            binding.deviceId,
                            binding.interfaceId,
                            binding.peerId,
                        )
                    }
                    managedTunnelRepository.bind(
                        binding.copy(
                            deviceName = device.name,
                            interfaceId = key.interfaceId,
                            peerId = key.peerId,
                            label = config.displayLabel,
                            endpoint = config.endpoint,
                            revision = config.revision,
                            syncedAt = now(),
                        ),
                    )
                }
            }
        }

        for (binding in managedTunnelRepository.getAll()) {
            val active =
                binding.deviceId in activeDeviceIds &&
                    BindingKey(binding.deviceId, binding.interfaceId, binding.peerId) in matched
            if (active) continue
            val tunnel = tunnelRepository.getById(binding.tunnelId)
            removedNames += tunnel?.name ?: binding.deviceName
            removalReasons += removalReason(snapshotDevices, binding.deviceId)
            tunnel?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId, binding.peerId)
            removedCount++
        }

        emitEvents(
            updatedCount = updatedCount,
            updatedNames = updatedNames,
            removedCount = removedCount,
            removedNames = removedNames,
            removalReasons = removalReasons,
        )

        return SyncResult.Success(
            created = createdCount,
            updated = updatedCount,
            removed = removedCount,
        )
    }

    private suspend fun loadDeviceConfigs(
        devices: List<AccountDevice>,
    ): Map<String, List<DeviceConfig>> = coroutineScope {
        val permits = Semaphore(maxParallelDeviceLoads.coerceAtLeast(1))
        devices
            .map { device ->
                async {
                    permits.withPermit {
                        when (val result = accountRepository.deviceConfigs(device.id)) {
                            is AccountResult.Failure -> throw SyncAbort(result.error.toSyncResult())
                            is AccountResult.Success -> device.id to result.value
                        }
                    }
                }
            }
            .awaitAll()
            .toMap()
    }

    private fun emitEvents(
        updatedCount: Int,
        updatedNames: List<String>,
        removedCount: Int,
        removedNames: List<String>,
        removalReasons: List<SyncRemovalReason>,
    ) {
        if (updatedCount > 0) {
            _events.tryEmit(
                SyncEvent.Updated(count = updatedCount, names = updatedNames.distinct()),
            )
        }
        if (removedCount > 0) {
            _events.tryEmit(
                SyncEvent.Removed(
                    count = removedCount,
                    names = removedNames.distinct(),
                    reason = dominantRemovalReason(removalReasons),
                ),
            )
        }
    }

    private fun removalReason(
        devices: List<AccountDevice>,
        deviceId: String,
    ): SyncRemovalReason {
        val device = devices.firstOrNull { it.id == deviceId }
        return when {
            device == null -> SyncRemovalReason.Deleted
            device.revoked -> SyncRemovalReason.Revoked
            else -> SyncRemovalReason.PeerRemoved
        }
    }

    private fun dominantRemovalReason(reasons: List<SyncRemovalReason>): SyncRemovalReason =
        when {
            SyncRemovalReason.Revoked in reasons -> SyncRemovalReason.Revoked
            SyncRemovalReason.Deleted in reasons -> SyncRemovalReason.Deleted
            else -> SyncRemovalReason.PeerRemoved
        }

    private fun findBinding(
        deviceBindings: List<ManagedTunnel>,
        consumedTunnelIds: Set<Int>,
        key: BindingKey,
        primary: Boolean,
    ): ManagedTunnel? {
        val available = deviceBindings.filterNot { it.tunnelId in consumedTunnelIds }
        return available.firstOrNull {
            it.peerId == key.peerId && it.interfaceId == key.interfaceId
        }
            ?: available.firstOrNull { it.peerId.isBlank() && it.interfaceId == key.interfaceId }
            ?: available.firstOrNull { it.peerId.isBlank() && it.interfaceId.isBlank() }
            ?: available.firstOrNull { primary && it.peerId.isBlank() }
    }

    private fun AccountError.toSyncResult(): SyncResult =
        when (this) {
            AccountError.Network -> SyncResult.Offline
            AccountError.SessionExpired -> SyncResult.SessionExpired
            AccountError.Unauthorized -> SyncResult.SessionExpired
            AccountError.ServerNotConfigured -> SyncResult.NotConfigured
            AccountError.TariffRequired,
            AccountError.SubscriptionInactive -> SyncResult.Failed(ACCESS_RESTRICTED_MESSAGE)
            is AccountError.Disabled -> SyncResult.Failed(ACCESS_RESTRICTED_MESSAGE)
            is AccountError.Api -> SyncResult.Failed(message)
            is AccountError.Unexpected -> SyncResult.Failed(message ?: UNKNOWN_ERROR_MESSAGE)
        }

    private companion object {
        const val CONFIG_ERROR_MESSAGE = "Invalid tunnel config"
        const val SAVE_ERROR_MESSAGE = "Failed to persist tunnel"
        const val UNKNOWN_ERROR_MESSAGE = "Unknown sync error"
        const val ACCESS_RESTRICTED_MESSAGE = "Account access is restricted"
        const val EVENT_BUFFER_CAPACITY = 16
        const val DEFAULT_SYNC_TIMEOUT_MILLIS = 25_000L
        const val DEFAULT_MAX_PARALLEL_DEVICE_LOADS = 4
    }
}

private class SyncAbort(val result: SyncResult) : Exception()

internal data class BindingKey(
    val deviceId: String,
    val interfaceId: String,
    val peerId: String,
)

internal const val MANAGED_INTERFACE_NAME_SEPARATOR = " · "

internal fun bindingKey(device: AccountDevice, config: DeviceConfig, index: Int): BindingKey =
    BindingKey(
        deviceId = device.id,
        interfaceId = managedInterfaceKey(config, index),
        peerId = config.peerId.trim(),
    )

internal val DeviceConfig.displayLabel: String
    get() = label.trim()

internal fun managedInterfaceKey(config: DeviceConfig, index: Int): String =
    config.interfaceId
        .trim()
        .ifEmpty { config.interfaceName.trim() }
        .ifEmpty { "interface-${index + 1}" }

internal fun managedTunnelBaseName(
    deviceName: String,
    config: DeviceConfig,
    primary: Boolean,
): String {
    if (primary) return deviceName
    val suffix =
        config.displayLabel
            .ifEmpty { config.interfaceName.trim() }
            .ifEmpty { config.interfaceId.trim() }
            .ifEmpty { UNKNOWN_INTERFACE_NAME }
    return "$deviceName$MANAGED_INTERFACE_NAME_SEPARATOR$suffix"
}

internal fun orderManagedConfigs(
    device: AccountDevice,
    configs: List<DeviceConfig>,
): List<DeviceConfig> {
    if (configs.size < 2) return configs
    val primaryIndex = configs.indexOfFirst {
        it.interfaceId.isNotBlank() && it.interfaceId == device.interfaceId
    }
    if (primaryIndex <= 0) return configs
    return listOf(configs[primaryIndex]) +
        configs.filterIndexed { index, _ -> index != primaryIndex }
}

private const val UNKNOWN_INTERFACE_NAME = "interface"
