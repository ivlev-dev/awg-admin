package space.ivlev.umbravpn.domain.sync

sealed interface SyncResult {
    data class Success(
        val created: Int = 0,
        val updated: Int = 0,
        val removed: Int = 0,
    ) : SyncResult

    data object NotConfigured : SyncResult

    data object Offline : SyncResult

    data object SessionExpired : SyncResult

    data class Failed(val message: String) : SyncResult
}
