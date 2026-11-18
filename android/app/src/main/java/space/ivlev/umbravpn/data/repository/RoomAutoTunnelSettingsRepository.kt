package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.AutoTunnelSettingsDao
import space.ivlev.umbravpn.data.entity.AutoTunnelSettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.AutoTunnelSettings as Domain
import space.ivlev.umbravpn.domain.repository.AutoTunnelSettingsRepository

class RoomAutoTunnelSettingsRepository(private val autoTunnelSettingsDao: AutoTunnelSettingsDao) :
    AutoTunnelSettingsRepository {
    override suspend fun upsert(autoTunnelSettings: Domain) {
        autoTunnelSettingsDao.upsert(autoTunnelSettings.toEntity())
    }

    override val flow: Flow<Domain>
        get() =
            autoTunnelSettingsDao.getAutoTunnelSettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getAutoTunnelSettings(): Domain {
        return (autoTunnelSettingsDao.getAutoTunnelSettings() ?: Entity()).toDomain()
    }

    override suspend fun updateAutoTunnelEnabled(enabled: Boolean) {
        autoTunnelSettingsDao.updateAutoTunnelEnabled(enabled)
    }

    override suspend fun updateDisableOnCaptivePortal(enabled: Boolean) {
        autoTunnelSettingsDao.updateDisableOnCaptivePortal(enabled)
    }
}
