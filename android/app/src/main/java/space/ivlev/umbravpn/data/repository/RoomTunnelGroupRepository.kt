package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.TunnelGroupDao
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.TunnelGroup as Domain
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository

class RoomTunnelGroupRepository(private val tunnelGroupDao: TunnelGroupDao) :
    TunnelGroupRepository {

    override val flow = tunnelGroupDao.getAllFlow().map { groups -> groups.map { it.toDomain() } }

    override suspend fun getAll(): List<Domain> {
        return tunnelGroupDao.getAll().map { it.toDomain() }
    }

    override suspend fun getById(id: Int): Domain? {
        return tunnelGroupDao.getById(id)?.toDomain()
    }

    override suspend fun save(group: Domain): Int {
        val rowId = tunnelGroupDao.upsert(group.toEntity())
        // Upsert returns -1 for an update, the id is already known then
        return if (rowId > 0) rowId.toInt() else group.id
    }

    override suspend fun saveAll(groups: List<Domain>) {
        groups.forEach { tunnelGroupDao.upsert(it.toEntity()) }
    }

    override suspend fun delete(group: Domain) {
        tunnelGroupDao.delete(group.toEntity())
    }

    override suspend fun setExpanded(id: Int, expanded: Boolean) {
        tunnelGroupDao.setExpanded(id, expanded)
    }
}
