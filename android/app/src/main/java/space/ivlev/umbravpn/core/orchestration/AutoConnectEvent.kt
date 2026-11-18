package space.ivlev.umbravpn.core.orchestration

sealed interface AutoConnectEvent {
    data class NeedsPermission(val tunnelId: Int) : AutoConnectEvent

    data class Connected(val tunnelId: Int) : AutoConnectEvent

    data class Failed(val tunnelId: Int) : AutoConnectEvent
}
