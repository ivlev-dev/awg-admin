package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.enums.StatisticRefresh

data class MonitoringUiState(
    val tunnelStatisticsEnabled: Boolean = false,
    val statisticRefresh: StatisticRefresh = StatisticRefresh.BALANCED,
    val isLoading: Boolean = true,
)
