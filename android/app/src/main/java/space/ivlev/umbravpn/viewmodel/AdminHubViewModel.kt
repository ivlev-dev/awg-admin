package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminHubUiState

class AdminHubViewModel(
    private val repository: AdminRepository,
    private val authRepository: AuthRepository,
) : OrbitContainerHost<AdminHubUiState, AdminHubUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminHubUiState, Nothing>(AdminHubUiState()) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true) }
                    return@intent
                }
                load(silent = false)
            }
        }

    fun refresh() = intent {
        if (state.isLoading || state.isRefreshing) return@intent
        load(silent = state.overview != null)
    }

    fun retry() = intent {
        reduce { state.copy(error = null) }
        load(silent = false)
    }

    private suspend fun Syntax<AdminHubUiState, Nothing>.load(silent: Boolean) {
        reduce {
            state.copy(
                isLoading = !silent,
                isRefreshing = silent,
                error = null,
            )
        }
        when (val result = repository.dashboard()) {
            is AccountResult.Success -> {
                reduce {
                    state.copy(
                        overview = result.value.overview,
                        pendingUsers = result.value.pendingUsers,
                        isLoading = false,
                        isRefreshing = false,
                        error = null,
                    )
                }
                loadCounters()
            }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminHubUiState, Nothing>.loadCounters() {
        when (val settings = repository.settings()) {
            is AccountResult.Success ->
                reduce { state.copy(retentionDays = settings.value.statsRetentionDays) }
            is AccountResult.Failure -> Unit
        }
        when (val audit = repository.audit(AdminAuditQuery(limit = RECENT_AUDIT_LIMIT))) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        recentAudit = audit.value.items.size,
                        hasMoreAudit = audit.value.nextCursor != null,
                    )
                }
            is AccountResult.Failure -> Unit
        }
    }
}

private const val RECENT_AUDIT_LIMIT = 20
