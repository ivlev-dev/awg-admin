package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminNodeDialog
import space.ivlev.umbravpn.ui.state.AdminNodesUiState
import space.ivlev.umbravpn.ui.state.AdminTokenReason
import space.ivlev.umbravpn.ui.state.AdminTokenReveal

class AdminNodesViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) : OrbitContainerHost<AdminNodesUiState, AdminNodesUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminNodesUiState, Nothing>(AdminNodesUiState()) {
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

    fun showDelete(nodeId: String, name: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = AdminNodeDialog.Delete(nodeId, name), dialogError = null) }
    }

    fun showRotate(nodeId: String, name: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = AdminNodeDialog.Rotate(nodeId, name), dialogError = null) }
    }

    fun dismissDialog() = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = null, dialogError = null) }
    }

    fun dismissToken() = intent { reduce { state.copy(revealedToken = null) } }

    fun delete() = intent {
        val dialog = state.dialog as? AdminNodeDialog.Delete ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.deleteNode(dialog.id)) {
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

    fun rotate() = intent {
        val dialog = state.dialog as? AdminNodeDialog.Rotate ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.rotateNodeToken(dialog.id)) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                        revealedToken =
                            AdminTokenReveal(
                                nodeName = result.value.nodeName,
                                token = result.value.token,
                                reason = AdminTokenReason.Rotated,
                            ),
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

    private suspend fun Syntax<AdminNodesUiState, Nothing>.load(silent: Boolean) {
        reduce {
            state.copy(
                isLoading = !silent,
                isRefreshing = silent,
                error = null,
            )
        }
        when (val result = repository.nodes()) {
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
