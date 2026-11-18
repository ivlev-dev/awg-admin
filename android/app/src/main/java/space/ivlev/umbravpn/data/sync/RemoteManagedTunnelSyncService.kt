package space.ivlev.umbravpn.data.sync

import com.wgtunnel.parser.Config
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
) : ManagedTunnelSyncService {

    private val mutex = Mutex()

    override suspend fun sync(): SyncResult = mutex.withLock { performSync() }

    private suspend fun performSync(): SyncResult {
        if (session.value !is SessionState.Active) return SyncResult.NotConfigured
        if (accountSettingsRepository.serverUrl().isBlank()) return SyncResult.NotConfigured

        val snapshot =
            when (val result = accountRepository.bootstrap()) {
                is AccountResult.Failure -> return result.error.toSyncResult()
                is AccountResult.Success -> result.value
            }

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
            val loaded = mutableMapOf<String, List<DeviceConfig>>()
            for (device in activeDevices) {
                val deviceConfigs =
                    when (val result = accountRepository.deviceConfigs(device.id)) {
                        is AccountResult.Failure -> return result.error.toSyncResult()
                        is AccountResult.Success -> result.value
                    }
                loaded[device.id] = deviceConfigs
            }
            configs = loaded
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

        val bindings = managedTunnelRepository.getAll()
        val activeDeviceIds = activeDevices.mapTo(mutableSetOf()) { it.id }
        val desiredKeys =
            activeDevices.flatMapTo(mutableSetOf()) { device ->
                orderManagedConfigs(device, configs[device.id].orEmpty()).mapIndexed { index, config
                    ->
                    BindingKey(device.id, managedInterfaceKey(config, index))
                }
            }
        val reusableLegacyDeviceIds =
            bindings
                .filter { it.deviceId in activeDeviceIds && it.interfaceId.isBlank() }
                .mapTo(mutableSetOf()) { it.deviceId }

        var removedCount = 0
        for (binding in bindings) {
            val desired =
                BindingKey(binding.deviceId, binding.interfaceId) in desiredKeys ||
                    binding.deviceId in reusableLegacyDeviceIds
            if (desired) continue
            tunnelRepository.getById(binding.tunnelId)?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId)
            removedCount++
        }

        val remainingTunnels = tunnelRepository.getAll()
        val usedNames = remainingTunnels.mapTo(mutableSetOf()) { it.name }
        var nextPosition = (remainingTunnels.maxOfOrNull { it.position } ?: -1) + 1
        var createdCount = 0
        var updatedCount = 0
        val matched = mutableSetOf<BindingKey>()

        for (device in activeDevices) {
            val ordered = orderManagedConfigs(device, configs[device.id].orEmpty())
            val deviceBindings = bindings.filter { it.deviceId == device.id }
            val legacyBinding = deviceBindings.firstOrNull { it.interfaceId.isBlank() }

            ordered.forEachIndexed { index, config ->
                val key = managedInterfaceKey(config, index)
                if (!matched.add(BindingKey(device.id, key))) return@forEachIndexed
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
                    deviceBindings.firstOrNull { it.interfaceId == key }
                        ?: legacyBinding?.takeIf { primary && it.interfaceId != key }
                val existing = binding?.let { tunnelRepository.getById(it.tunnelId) }

                if (existing == null) {
                    if (binding != null) {
                        managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId)
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
                            interfaceId = key,
                            endpoint = config.endpoint,
                            revision = config.revision,
                            syncedAt = now(),
                        ),
                    )
                    usedNames += name
                    createdCount++
                } else {
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
                    }
                    if (binding.interfaceId != key) {
                        managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId)
                    }
                    managedTunnelRepository.bind(
                        binding.copy(
                            deviceName = device.name,
                            interfaceId = key,
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
                    BindingKey(binding.deviceId, binding.interfaceId) in matched
            if (active) continue
            tunnelRepository.getById(binding.tunnelId)?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId)
            removedCount++
        }

        return SyncResult.Success(
            created = createdCount,
            updated = updatedCount,
            removed = removedCount,
        )
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
    }
}

internal data class BindingKey(val deviceId: String, val interfaceId: String)

internal const val MANAGED_INTERFACE_NAME_SEPARATOR = " · "

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
        config.interfaceName
            .trim()
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
