package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel

interface ManagedTunnelRepository {
    val flow: Flow<List<ManagedTunnel>>

    suspend fun getAll(): List<ManagedTunnel>

    suspend fun getByDevice(deviceId: String): List<ManagedTunnel>

    suspend fun getByTunnelId(tunnelId: Int): ManagedTunnel?

    suspend fun bind(binding: ManagedTunnel)

    suspend fun unbind(deviceId: String, interfaceId: String, peerId: String)

    suspend fun unbindDevice(deviceId: String)

    suspend fun unbindByTunnelId(tunnelId: Int)
}
