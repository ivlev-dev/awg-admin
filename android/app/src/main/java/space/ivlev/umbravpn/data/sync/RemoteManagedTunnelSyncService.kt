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
        val configs: Map<String, DeviceConfig>
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
                configs = mapOf(created.device.id to created.config)
            }
        } else {
            activeDevices = snapshot.devices.filterNot { it.revoked }
            val loaded = mutableMapOf<String, DeviceConfig>()
            for (device in activeDevices) {
                val config =
                    when (val result = accountRepository.deviceConfig(device.id)) {
                        is AccountResult.Failure -> return result.error.toSyncResult()
                        is AccountResult.Success -> result.value
                    }
                loaded[device.id] = config
            }
            configs = loaded
        }

        if (activeDevices.isNotEmpty()) accountSettingsRepository.setManagedProvisioned(true)

        val bindings = managedTunnelRepository.getAll()
        val bindingsByDevice = bindings.associateBy { it.deviceId }
        val tunnels = tunnelRepository.getAll()
        val usedNames = tunnels.mapTo(mutableSetOf()) { it.name }
        var nextPosition = (tunnels.maxOfOrNull { it.position } ?: -1) + 1
        var createdCount = 0
        var updatedCount = 0

        for (device in activeDevices) {
            val config = configs.getValue(device.id)
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
            val imported = TunnelConfig.fromConfig(parsed, device.name)
            val binding = bindingsByDevice[device.id]
            val existing = binding?.let { tunnelRepository.getById(it.tunnelId) }

            if (binding == null || existing == null) {
                if (binding != null) managedTunnelRepository.unbind(device.id)
                val name = uniqueTunnelName(imported.name, usedNames)
                tunnelRepository.save(imported.copy(name = name, position = nextPosition++))
                val saved =
                    tunnelRepository.findByTunnelName(name)
                        ?: return SyncResult.Failed(SAVE_ERROR_MESSAGE)
                managedTunnelRepository.bind(
                    ManagedTunnel(
                        deviceId = device.id,
                        tunnelId = saved.id,
                        deviceName = device.name,
                        interfaceId = config.interfaceId,
                        endpoint = config.endpoint,
                        revision = config.revision,
                        syncedAt = now(),
                    ),
                )
                usedNames += name
                createdCount++
                continue
            }

            val name =
                if (binding.deviceName != device.name) {
                    uniqueTunnelName(device.name, usedNames - existing.name)
                } else {
                    existing.name
                }
            val nextQuickConfig =
                if (binding.revision != config.revision) quickConfig else existing.quickConfig
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
            managedTunnelRepository.bind(
                binding.copy(
                    deviceName = device.name,
                    interfaceId = config.interfaceId,
                    endpoint = config.endpoint,
                    revision = config.revision,
                    syncedAt = now(),
                ),
            )
        }

        var removedCount = 0
        val activeDeviceIds = activeDevices.mapTo(mutableSetOf()) { it.id }
        for (binding in bindings) {
            if (binding.deviceId in activeDeviceIds) continue
            tunnelRepository.getById(binding.tunnelId)?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId)
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
