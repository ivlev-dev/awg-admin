package space.ivlev.umbravpn.core.orchestration

import android.content.Intent
import space.ivlev.umbravpn.core.shortcut.ShortcutContract
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository

class ShortcutCoordinator(
    private val settingsRepository: GeneralSettingRepository,
    private val tunnelsRepository: TunnelRepository,
    private val tunnelCoordinator: TunnelCoordinator,
) {

    suspend fun handle(intent: Intent) {

        val settings = settingsRepository.getGeneralSettings()

        if (!settings.isShortcutsEnabled) return

        val shortcutType =
            intent.getStringExtra(ShortcutContract.EXTRA_SHORTCUT_TYPE)
                ?: legacyShortcutType(intent)

        when (shortcutType) {
            ShortcutContract.ShortcutType.TUNNEL.value -> {
                handleTunnelShortcut(intent)
            }
        }
    }

    private fun legacyShortcutType(intent: Intent): String? {

        return when (intent.getStringExtra(ShortcutContract.EXTRA_CLASS_NAME)) {
            ShortcutContract.Legacy.TUNNEL_PROVIDER_NAME,
            ShortcutContract.Legacy.TUNNEL_SERVICE_NAME ->
                ShortcutContract.ShortcutType.TUNNEL.value

            else -> null
        }
    }

    private suspend fun handleTunnelShortcut(intent: Intent) {

        val tunnelName = intent.getStringExtra(ShortcutContract.EXTRA_TUNNEL_NAME)

        val tunnel =
            tunnelName?.let { tunnelsRepository.findByTunnelName(it) }
                ?: tunnelsRepository.getDefaultTunnel()

        tunnel ?: return

        when (intent.action) {
            ShortcutContract.Action.START.name -> {
                tunnelCoordinator.startTunnel(config = tunnel)
            }

            ShortcutContract.Action.STOP.name -> {
                tunnelCoordinator.stopActiveTunnels()
            }
        }
    }
}
