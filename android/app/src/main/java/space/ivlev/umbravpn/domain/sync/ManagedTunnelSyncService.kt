package space.ivlev.umbravpn.domain.sync

interface ManagedTunnelSyncService {
    suspend fun sync(): SyncResult
}
