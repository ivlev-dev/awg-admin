package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.enums.StatisticRefresh
import space.ivlev.umbravpn.domain.repository.MonitoringSettingsRepository
import space.ivlev.umbravpn.ui.state.MonitoringUiState

class MonitoringViewModel(private val monitoringSettingsRepository: MonitoringSettingsRepository) :
    OrbitContainerHost<MonitoringUiState, MonitoringUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<MonitoringUiState, Nothing>(
            MonitoringUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            monitoringSettingsRepository.flow.collect {
                val statisticRefresh = StatisticRefresh.fromValue(it.tunnelStatisticsPollInterval)
                reduce {
                    state.copy(
                        statisticRefresh = statisticRefresh,
                        tunnelStatisticsEnabled = it.tunnelStatisticsEnabled,
                        isLoading = false,
                    )
                }
            }
        }

    fun onLiveTunnelStatisticsChanged(to: Boolean) = intent {
        monitoringSettingsRepository.updateStatisticsEnabled(to)
    }

    fun onStatisticsIntervalChanged(statisticRefresh: StatisticRefresh) = intent {
        monitoringSettingsRepository.updateStatisticRefresh(statisticRefresh.value)
    }
}
