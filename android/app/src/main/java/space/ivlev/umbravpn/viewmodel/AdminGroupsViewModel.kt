package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminGroup
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminGroupDialog
import space.ivlev.umbravpn.ui.state.AdminGroupsUiState

class AdminGroupsViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) : OrbitContainerHost<AdminGroupsUiState, AdminGroupsUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminGroupsUiState, Nothing>(AdminGroupsUiState()) {
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
        load(silent = state.isLoaded)
    }

    fun refreshIfLoaded() = intent {
        if (!state.isLoaded || state.isLoading) return@intent
        load(silent = true)
    }

    fun retry() = intent {
        reduce { state.copy(error = null) }
        load(silent = false)
    }

    fun showDelete(group: AdminGroup) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog =
                    AdminGroupDialog.Delete(
                        id = group.id,
                        name = group.name,
                        interfaces = group.interfaces,
                        devices = group.devices,
                    ),
                dialogError = null,
            )
        }
    }

    fun dismissDialog() = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = null, dialogError = null) }
    }

    fun delete() = intent {
        val dialog = state.dialog as? AdminGroupDialog.Delete ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.deleteGroup(dialog.id)) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        items = state.items.filterNot { it.id == dialog.id },
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                    )
                }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialogError = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminGroupsUiState, Nothing>.load(silent: Boolean) {
        reduce {
            state.copy(
                isLoading = !silent,
                isRefreshing = silent,
                error = null,
            )
        }
        when (val result = repository.groups()) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        items = result.value,
                        isLoaded = true,
                        isLoading = false,
                        isRefreshing = false,
                        error = null,
                    )
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
}
