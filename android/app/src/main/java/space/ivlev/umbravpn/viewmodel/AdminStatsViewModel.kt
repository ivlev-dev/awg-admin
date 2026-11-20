package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import java.time.Instant
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminStatsQuery
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminStatsUiState

class AdminStatsViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val now: () -> Instant = { Instant.now() },
) : OrbitContainerHost<AdminStatsUiState, AdminStatsUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminStatsUiState, Nothing>(AdminStatsUiState()) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true) }
                    return@intent
                }
                loadAll(silent = false)
            }
        }

    fun refresh() = intent {
        if (state.isLoading || state.isRefreshing) return@intent
        loadAll(silent = state.isLoaded)
    }

    fun retry() = intent {
        reduce { state.copy(error = null, seriesError = null, quotaError = null) }
        loadAll(silent = false)
    }

    fun setPeriod(period: AdminStatsPeriod) = intent {
        if (state.period == period) return@intent
        reduce { state.copy(period = period, series = emptyList(), seriesError = null) }
        loadTraffic()
    }

    private suspend fun Syntax<AdminStatsUiState, Nothing>.loadAll(silent: Boolean) {
        reduce {
            state.copy(
                isLoading = !silent,
                isRefreshing = silent,
                error = null,
                seriesError = null,
                quotaError = null,
            )
        }
        when (val result = repository.overview()) {
            is AccountResult.Success -> reduce { state.copy(overview = result.value) }
            is AccountResult.Failure -> {
                reduce {
                    state.copy(
                        overview = null,
                        isLoading = false,
                        isRefreshing = false,
                        isLoaded = true,
                        error = AdminMessages.of(result.error),
                    )
                }
                return
            }
        }
        loadTraffic()
        loadQuotas()
        reduce {
            state.copy(
                isLoading = false,
                isRefreshing = false,
                isLoaded = true,
                error = null,
            )
        }
    }

    private suspend fun Syntax<AdminStatsUiState, Nothing>.loadTraffic() {
        val to = now()
        val query =
            AdminStatsQuery(
                period = state.period,
                from = to.minusSeconds(state.period.windowSeconds),
                to = to,
            )
        reduce { state.copy(isSeriesLoading = true) }
        when (val result = repository.traffic(query)) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        series = result.value,
                        seriesError = null,
                        isSeriesLoading = false,
                    )
                }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        series = emptyList(),
                        seriesError = AdminMessages.of(result.error),
                        isSeriesLoading = false,
                    )
                }
        }
    }

    private suspend fun Syntax<AdminStatsUiState, Nothing>.loadQuotas() {
        when (val result = repository.quotaUsers()) {
            is AccountResult.Success ->
                reduce { state.copy(quotaUsers = result.value, quotaError = null) }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        quotaUsers = emptyList(),
                        quotaError = AdminMessages.of(result.error),
                    )
                }
        }
    }
}
