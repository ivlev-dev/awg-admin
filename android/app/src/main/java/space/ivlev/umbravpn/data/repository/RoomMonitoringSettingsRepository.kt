package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.MonitoringSettingsDao
import space.ivlev.umbravpn.data.entity.MonitoringSettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.MonitoringSettings as Domain
import space.ivlev.umbravpn.domain.repository.MonitoringSettingsRepository

class RoomMonitoringSettingsRepository(private val monitoringSettingsDao: MonitoringSettingsDao) :
    MonitoringSettingsRepository {
    override suspend fun upsert(monitoringSettings: Domain) {
        monitoringSettingsDao.upsert(monitoringSettings.toEntity())
    }

    override val flow: Flow<Domain>
        get() =
            monitoringSettingsDao.getMonitoringSettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getMonitoringSettings(): Domain {
        return (monitoringSettingsDao.getMonitoringSettings() ?: Entity()).toDomain()
    }

    override suspend fun updateStatisticRefresh(statisticRefresh: Int) {
        monitoringSettingsDao.updateStatisticsInterval(statisticRefresh)
    }

    override suspend fun updateStatisticsEnabled(enabled: Boolean) {
        monitoringSettingsDao.updateStatisticsEnabled(enabled)
    }
}
