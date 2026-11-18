package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.ManagedTunnelDao
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository

class RoomManagedTunnelRepository(private val managedTunnelDao: ManagedTunnelDao) :
    ManagedTunnelRepository {

    override val flow: Flow<List<ManagedTunnel>> =
        managedTunnelDao.getAllFlow().map { bindings -> bindings.map { it.toDomain() } }

    override suspend fun getAll(): List<ManagedTunnel> =
        managedTunnelDao.getAll().map { it.toDomain() }

    override suspend fun getByDevice(deviceId: String): List<ManagedTunnel> =
        managedTunnelDao.getByDevice(deviceId).map { it.toDomain() }

    override suspend fun getByTunnelId(tunnelId: Int): ManagedTunnel? =
        managedTunnelDao.getByTunnelId(tunnelId)?.toDomain()

    override suspend fun bind(binding: ManagedTunnel) {
        managedTunnelDao.upsert(binding.toEntity())
    }

    override suspend fun unbind(deviceId: String, interfaceId: String) {
        managedTunnelDao.deleteByKey(deviceId, interfaceId)
    }

    override suspend fun unbindDevice(deviceId: String) {
        managedTunnelDao.deleteByDeviceId(deviceId)
    }

    override suspend fun unbindByTunnelId(tunnelId: Int) {
        managedTunnelDao.deleteByTunnelId(tunnelId)
    }
}
