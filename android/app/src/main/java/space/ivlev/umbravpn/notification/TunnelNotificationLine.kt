package space.ivlev.umbravpn.notification

import space.ivlev.umbravpn.domain.enums.TunnelActionSource
import space.ivlev.umbravpn.ui.state.DisplayTunnelState

data class TunnelNotificationLine(
    val id: Int,
    val name: String,
    val viaName: String? = null,
    val displayState: DisplayTunnelState,
    val startedAtMillis: Long?,
    val origin: TunnelActionSource?,
    val rxBytes: Long = 0L,
    val txBytes: Long = 0L,
    val recoveryAttempts: Int = 0,
    val lockdown: Boolean = false,
)
