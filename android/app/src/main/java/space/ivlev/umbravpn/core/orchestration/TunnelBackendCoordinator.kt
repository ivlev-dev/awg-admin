package space.ivlev.umbravpn.core.orchestration

import space.ivlev.umbravpn.core.tunnel.TunnelProvider
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.LockdownSettingsRepository

class TunnelBackendCoordinator(
    private val tunnelProvider: TunnelProvider,
    private val settingsRepository: GeneralSettingRepository,
    private val lockdownRepository: LockdownSettingsRepository,
) {

    suspend fun changeMode(newMode: TunnelMode): Result<Unit> {

        val settings = settingsRepository.getGeneralSettings()
        val oldMode = settings.tunnelMode

        if (oldMode == newMode) {
            return Result.success(Unit)
        }

        return runCatching {
            tunnelProvider.stopActiveTunnels().getOrThrow()
            exitMode(oldMode)
            enterMode(newMode)

            settingsRepository.upsert(settings.copy(tunnelMode = newMode))
        }
    }

    private suspend fun exitMode(oldMode: TunnelMode) {
        when (oldMode) {
            TunnelMode.LOCK_DOWN -> {
                tunnelProvider.disableLockDown().getOrThrow()
            }
            else -> Unit
        }
    }

    private suspend fun enterMode(newMode: TunnelMode) {
        when (newMode) {
            TunnelMode.LOCK_DOWN -> {
                val lockdownSettings = lockdownRepository.getLockdownSettings()
                tunnelProvider.setLockDown(lockdownSettings).getOrThrow()
            }

            TunnelMode.VPN,
            TunnelMode.PROXY -> Unit
        }
    }
}
