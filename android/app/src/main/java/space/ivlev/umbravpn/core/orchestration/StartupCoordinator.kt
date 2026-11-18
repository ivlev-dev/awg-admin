package space.ivlev.umbravpn.core.orchestration

import kotlinx.coroutines.flow.first
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import timber.log.Timber

class StartupCoordinator(
    private val tunnelCoordinator: TunnelCoordinator,
    private val settingsRepository: GeneralSettingRepository,
    private val tunnelRepository: TunnelRepository,
    private val bootstrapCoordinator: AppBoostrapCoordinator,
    private val appStateRepository: AppStateRepository,
) {

    @Volatile private var vpnRevokedThisProcess = false
    @Volatile private var stickyRestoreRequested = false

    suspend fun applyStartupPolicy(): Result<Unit> = runCatching {
        val settings = settingsRepository.getGeneralSettings()
        if (!settings.isRestoreOnBootEnabled) {
            Timber.d("Boot policy: nothing to restore")
            return@runCatching
        }

        bootstrapCoordinator.isReady.first { it }

        val defaultTunnel = tunnelRepository.getDefaultTunnel() ?: return@runCatching
        Timber.d("Boot policy: starting default tunnel ${defaultTunnel.name}")
        tunnelCoordinator.startTunnel(defaultTunnel)
    }

    suspend fun restoreAfterPackageReplace(): Result<Unit> = restoreRuntimeState("package replace")

    suspend fun restoreAfterStickyRestart(): Result<Unit> {
        if (stickyRestoreRequested) {
            Timber.d("sticky restart: restore already requested")
            return Result.success(Unit)
        }
        stickyRestoreRequested = true
        return restoreRuntimeState("sticky restart")
    }

    fun markVpnRevoked() {
        vpnRevokedThisProcess = true
    }

    suspend fun handleVpnRevoked() {
        vpnRevokedThisProcess = true
        Timber.d("VPN revoked — clearing last-active tunnels so sticky restart does not take over")
        appStateRepository.clearLastActiveTunnelIds()
    }

    private suspend fun restoreRuntimeState(reason: String): Result<Unit> = runCatching {
        if (vpnRevokedThisProcess) {
            Timber.d("$reason: skipping restore after VPN revoke")
            return@runCatching
        }

        bootstrapCoordinator.isReady.first { it }

        val lastIds = appStateRepository.getLastActiveTunnelIds()
        val tunnels = lastIds.mapNotNull { tunnelRepository.getById(it) }
        if (tunnels.size != lastIds.size) {
            appStateRepository.setLastActiveTunnelIds(tunnels.map { it.id })
        }
        if (tunnels.isEmpty()) {
            appStateRepository.clearLastActiveTunnelIds()
            Timber.d("$reason: no active tunnels to restore")
            return@runCatching
        }

        Timber.d("$reason: restoring tunnels ${tunnels.map { it.id }}")
        tunnels.forEach { tunnelCoordinator.startTunnel(it) }
    }

    suspend fun handleAlwaysOnTrigger() {
        val settings = settingsRepository.getGeneralSettings()
        if (!settings.isAlwaysOnVpnEnabled) {
            Timber.d("Always-On trigger ignored: support is disabled")
            return
        }

        bootstrapCoordinator.isReady.first { it }
        val defaultTunnel = tunnelRepository.getDefaultTunnel() ?: return
        Timber.d("Always-On trigger: starting default tunnel ${defaultTunnel.name}")
        tunnelCoordinator.startTunnel(defaultTunnel)
    }
}
