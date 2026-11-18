package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.MonitoringSettings

interface MonitoringSettingsRepository {
    suspend fun upsert(monitoringSettings: MonitoringSettings)

    val flow: Flow<MonitoringSettings>

    suspend fun getMonitoringSettings(): MonitoringSettings

    suspend fun updateStatisticRefresh(statisticRefresh: Int)

    suspend fun updateStatisticsEnabled(enabled: Boolean)
}
