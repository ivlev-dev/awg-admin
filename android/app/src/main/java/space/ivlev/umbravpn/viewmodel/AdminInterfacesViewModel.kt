package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminInterface
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminInterfaceDialog
import space.ivlev.umbravpn.ui.state.AdminInterfaceReveal
import space.ivlev.umbravpn.ui.state.AdminInterfacesUiState

class AdminInterfacesViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) : OrbitContainerHost<AdminInterfacesUiState, AdminInterfacesUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminInterfacesUiState, Nothing>(AdminInterfacesUiState()) {
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

    fun setNodeFilter(nodeId: String?) = intent { reduce { state.copy(nodeFilter = nodeId) } }

    fun setGroupFilter(groupId: String?) = intent { reduce { state.copy(groupFilter = groupId) } }

    fun showDelete(item: AdminInterface) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminInterfaceDialog.Delete(item.id, interfaceLabel(item)),
                dialogError = null,
            )
        }
    }

    fun showRotate(item: AdminInterface) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminInterfaceDialog.Rotate(item.id, interfaceLabel(item)),
                dialogError = null,
            )
        }
    }

    fun dismissDialog() = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = null, dialogError = null) }
    }

    fun dismissReveal() = intent { reduce { state.copy(revealedKey = null) } }

    fun delete() = intent {
        val dialog = state.dialog as? AdminInterfaceDialog.Delete ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.deleteInterface(dialog.id)) {
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
        val dialog = state.dialog as? AdminInterfaceDialog.Rotate ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.rotateInterface(dialog.id)) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        items = state.items.replace(result.value),
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                        revealedKey =
                            AdminInterfaceReveal(
                                name = interfaceLabel(result.value),
                                publicKey = result.value.publicKey,
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

    private suspend fun Syntax<AdminInterfacesUiState, Nothing>.load(silent: Boolean) {
        reduce {
            state.copy(
                isLoading = !silent,
                isRefreshing = silent,
                error = null,
            )
        }
        val nodes = repository.listNodes()
        val groups = repository.listGroups()
        when (val result = repository.interfaces()) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        items = result.value,
                        nodes = (nodes as? AccountResult.Success)?.value.orEmpty(),
                        groups = (groups as? AccountResult.Success)?.value.orEmpty(),
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

internal fun interfaceLabel(item: AdminInterface): String =
    item.label.takeIf { it.isNotBlank() } ?: item.name

private fun List<AdminInterface>.replace(item: AdminInterface): List<AdminInterface> {
    val index = indexOfFirst { it.id == item.id }
    if (index < 0) return this
    return toMutableList().also { it[index] = item }
}
