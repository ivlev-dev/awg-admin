package space.ivlev.umbravpn.domain.sync

sealed interface SyncEvent {
    data class Updated(val count: Int, val names: List<String>) : SyncEvent

    data class Removed(
        val count: Int,
        val names: List<String>,
        val reason: SyncRemovalReason,
    ) : SyncEvent
}

enum class SyncRemovalReason {
    Revoked,
    Deleted,
    PeerRemoved,
}
