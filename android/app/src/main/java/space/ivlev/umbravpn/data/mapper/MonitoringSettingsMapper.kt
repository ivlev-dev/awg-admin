package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.MonitoringSettings as Entity
import space.ivlev.umbravpn.domain.model.MonitoringSettings as Domain

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        tunnelStatisticsEnabled = tunnelStatisticsEnabled,
        tunnelStatisticsPollInterval = tunnelStatisticsPollInterval,
        isLocalLogsEnabled = isLocalLogsEnabled,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        tunnelStatisticsEnabled = tunnelStatisticsEnabled,
        tunnelStatisticsPollInterval = tunnelStatisticsPollInterval,
        isLocalLogsEnabled = isLocalLogsEnabled,
    )
