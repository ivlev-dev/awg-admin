package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.LockdownSettingsDao
import space.ivlev.umbravpn.data.entity.LockdownSettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.LockdownSettings as Domain
import space.ivlev.umbravpn.domain.repository.LockdownSettingsRepository

class RoomLockdownSettingsRepository(private val lockdownSettingsDao: LockdownSettingsDao) :
    LockdownSettingsRepository {
    override suspend fun upsert(lockdownSettings: Domain) {
        lockdownSettingsDao.upsert(lockdownSettings.toEntity())
    }

    override val flow =
        lockdownSettingsDao.getLockdownSettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getLockdownSettings(): Domain {
        return (lockdownSettingsDao.getLockdownSettings() ?: Entity()).toDomain()
    }
}
