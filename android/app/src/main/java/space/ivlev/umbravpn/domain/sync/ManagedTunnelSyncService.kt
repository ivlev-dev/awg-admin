package space.ivlev.umbravpn.domain.sync

import kotlinx.coroutines.flow.SharedFlow

interface ManagedTunnelSyncService {
    val events: SharedFlow<SyncEvent>

    suspend fun sync(): SyncResult
}
