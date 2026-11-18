package space.ivlev.umbravpn.core.orchestration

import android.content.Intent
import space.ivlev.umbravpn.domain.enums.NotificationAction
import space.ivlev.umbravpn.notification.NotificationService

class NotificationActionCoordinator(private val tunnelCoordinator: TunnelCoordinator) {

    suspend fun handle(intent: Intent) {
        when (intent.action) {
            NotificationAction.TUNNEL_OFF.name -> {

                val tunnelId = intent.getIntExtra(NotificationService.EXTRA_ID, STOP_ALL_TUNNELS_ID)

                if (tunnelId == STOP_ALL_TUNNELS_ID) {
                    tunnelCoordinator.stopActiveTunnels()
                    return
                }
                tunnelCoordinator.stopTunnel(tunnelId)
            }

            NotificationAction.STOP_ALL.name -> {
                tunnelCoordinator.stopActiveTunnels()
            }
        }
    }

    companion object {
        const val STOP_ALL_TUNNELS_ID = 0
    }
}
