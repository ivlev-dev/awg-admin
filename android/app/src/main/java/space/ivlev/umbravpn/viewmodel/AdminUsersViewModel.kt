package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.AdminValidation
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminRoleFilter
import space.ivlev.umbravpn.domain.model.admin.AdminStatusFilter
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminUserDialog
import space.ivlev.umbravpn.ui.state.AdminUsersState
import space.ivlev.umbravpn.ui.state.AdminUsersUiState

class AdminUsersViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) : OrbitContainerHost<AdminUsersUiState, AdminUsersUiState, Nothing>, ViewModel() {

    private var searchJob: Job? = null
    private var requestSeq = 0

    override val container =
        orbitContainer<AdminUsersUiState, Nothing>(AdminUsersUiState()) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true) }
                    return@intent
                }
                loadPage(reset = true)
            }
        }

    fun refresh() = intent {
        if (state.list.isLoading || state.list.isLoadingMore) return@intent
        loadPage(reset = true)
    }

    fun refreshIfLoaded() = intent {
        if (!state.list.isLoaded || state.list.isLoading) return@intent
        loadPage(reset = true)
    }

    fun retry() = intent {
        reduce { state.copy(list = state.list.copy(error = null)) }
        loadPage(reset = true)
    }

    fun loadMore() = intent { loadPage(reset = false) }

    fun setQuery(value: String) = intent {
        if (state.list.query == value) return@intent
        reduce { state.copy(list = state.list.copy(query = value, offset = 0, error = null)) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            intent { loadPage(reset = true) }
        }
    }

    fun setTab(tab: AdminUserTab) = intent {
        if (state.list.tab == tab) return@intent
        searchJob?.cancel()
        reduce {
            state.copy(
                list =
                    state.list.copy(tab = tab, offset = 0, items = emptyList(), isLoaded = false),
            )
        }
        loadPage(reset = true)
    }

    fun setRole(role: AdminRoleFilter) = intent {
        if (state.list.role == role) return@intent
        reduce { state.copy(list = state.list.copy(role = role, offset = 0, error = null)) }
        loadPage(reset = true)
    }

    fun setStatus(status: AdminStatusFilter) = intent {
        if (state.list.status == status) return@intent
        reduce { state.copy(list = state.list.copy(status = status, offset = 0, error = null)) }
        loadPage(reset = true)
    }

    fun showDelete(user: AdminUser) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminUserDialog.Delete(user.id, user.email),
                dialogError = null,
            )
        }
    }

    fun showResetPassword(user: AdminUser) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminUserDialog.ResetPassword(user.id, user.email),
                dialogError = null,
            )
        }
    }

    fun showSetDisabled(user: AdminUser) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog =
                    AdminUserDialog.SetDisabled(user.id, user.email, disabled = !user.disabled),
                dialogError = null,
            )
        }
    }

    fun showApprove(user: AdminUser) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminUserDialog.Approve(user.id, user.email),
                dialogError = null,
            )
        }
        loadTariffsIfNeeded()
    }

    fun showReject(user: AdminUser) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AdminUserDialog.Reject(user.id, user.email),
                dialogError = null,
            )
        }
    }

    fun dismissDialog() = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(dialog = null, dialogError = null) }
    }

    fun clearDialogError() = intent { reduce { state.copy(dialogError = null) } }

    fun approve(tariffId: String) = intent {
        val dialog = state.dialog as? AdminUserDialog.Approve ?: return@intent
        if (state.isActionInProgress) return@intent
        if (tariffId.isBlank()) {
            reduce { state.copy(dialogError = AdminMessage.TariffRequired) }
            return@intent
        }
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.approveUser(dialog.id, tariffId)) {
            is AccountResult.Success -> {
                reduce {
                    state.copy(
                        list = state.list.removeUser(dialog.id),
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                    )
                }
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

    fun reject() = intent {
        val dialog = state.dialog as? AdminUserDialog.Reject ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.rejectUser(dialog.id)) {
            is AccountResult.Success -> {
                reduce {
                    state.copy(
                        list = state.list.removeUser(dialog.id),
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                    )
                }
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

    fun delete() = intent {
        val dialog = state.dialog as? AdminUserDialog.Delete ?: return@intent
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.deleteUser(dialog.id)) {
            is AccountResult.Success -> {
                reduce {
                    state.copy(
                        list = state.list.removeUser(dialog.id),
                        dialog = null,
                        dialogError = null,
                        isActionInProgress = false,
                    )
                }
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

    fun setDisabled() = intent {
        val dialog = state.dialog as? AdminUserDialog.SetDisabled ?: return@intent
        if (state.isActionInProgress) return@intent
        val current = state.list.items.firstOrNull { it.id == dialog.id }
        if (current == null) {
            reduce { state.copy(dialog = null) }
            return@intent
        }
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (
            val result =
                repository.updateUser(
                    dialog.id,
                    AdminUserDraft(
                        email = current.email,
                        fullName = current.fullName,
                        role = current.role,
                        tariffId = current.tariffId,
                        nodeId = current.nodeId,
                        groupId = current.groupId,
                        disabled = dialog.disabled,
                    ),
                )
        ) {
            is AccountResult.Success -> {
                if (state.list.status == AdminStatusFilter.All) {
                    reduce {
                        state.copy(
                            list = state.list.replaceUser(result.value),
                            dialog = null,
                            dialogError = null,
                            isActionInProgress = false,
                        )
                    }
                } else {
                    reduce {
                        state.copy(
                            dialog = null,
                            dialogError = null,
                            isActionInProgress = false,
                        )
                    }
                    loadPage(reset = true)
                }
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

    fun resetPassword(newPassword: String) = intent {
        val dialog = state.dialog as? AdminUserDialog.ResetPassword ?: return@intent
        if (state.isActionInProgress) return@intent
        val validationError = AdminValidation.passwordError(newPassword)
        if (validationError != null) {
            reduce { state.copy(dialogError = validationError) }
            return@intent
        }
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        when (val result = repository.resetPassword(dialog.id, newPassword)) {
            is AccountResult.Success ->
                reduce { state.copy(dialog = null, dialogError = null, isActionInProgress = false) }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialogError = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminUsersUiState, Nothing>.loadTariffsIfNeeded() {
        if (state.tariffs.isNotEmpty() || state.isLoadingTariffs) return
        reduce { state.copy(isLoadingTariffs = true) }
        when (val result = repository.listTariffs()) {
            is AccountResult.Success ->
                reduce { state.copy(tariffs = result.value, isLoadingTariffs = false) }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isLoadingTariffs = false,
                        dialogError = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminUsersUiState, Nothing>.loadPage(reset: Boolean) {
        val current = state.list
        if (!reset && (!current.canLoadMore)) return

        val query =
            AdminUserQuery(
                limit = current.limit,
                offset = if (reset) 0 else current.items.size,
                query = current.query,
                tab = current.tab,
                role = current.role,
                status = current.status,
            )
        val seq = ++requestSeq
        reduce {
            state.copy(
                list =
                    state.list.copy(
                        isLoading = reset,
                        isLoadingMore = !reset,
                        error = null,
                    ),
            )
        }
        when (val result = repository.pageUsers(query)) {
            is AccountResult.Success ->
                reduce {
                    if (seq != requestSeq || !state.list.matches(query)) {
                        state
                    } else {
                        val page = result.value
                        val items =
                            if (reset) page.items.distinctBy { it.id }
                            else mergeUsers(state.list.items, page.items)
                        val total =
                            if (!reset && page.items.isEmpty()) items.size
                            else maxOf(page.total, items.size)
                        state.copy(
                            list =
                                state.list.copy(
                                    items = items,
                                    total = total,
                                    offset = items.size,
                                    isLoading = false,
                                    isLoadingMore = false,
                                    error = null,
                                    isLoaded = true,
                                ),
                        )
                    }
                }
            is AccountResult.Failure ->
                reduce {
                    if (seq != requestSeq || !state.list.matches(query)) {
                        state
                    } else {
                        state.copy(
                            list =
                                state.list.copy(
                                    isLoading = false,
                                    isLoadingMore = false,
                                    error = AdminMessages.of(result.error),
                                    isLoaded = true,
                                ),
                        )
                    }
                }
        }
    }
}

private const val SEARCH_DEBOUNCE_MS = 300L

private fun AdminUsersState.matches(query: AdminUserQuery): Boolean =
    this.query.trim() == query.query.trim() &&
        tab == query.tab &&
        role == query.role &&
        status == query.status

private fun AdminUsersState.removeUser(id: String): AdminUsersState {
    if (items.none { it.id == id }) return this
    val next = items.filterNot { it.id == id }
    return copy(items = next, total = (total - 1).coerceAtLeast(0), offset = next.size)
}

private fun AdminUsersState.replaceUser(user: AdminUser): AdminUsersState {
    val index = items.indexOfFirst { it.id == user.id }
    if (index < 0) return this
    return copy(items = items.toMutableList().also { it[index] = user })
}

private fun mergeUsers(existing: List<AdminUser>, incoming: List<AdminUser>): List<AdminUser> {
    if (incoming.isEmpty()) return existing
    val seen = existing.mapTo(HashSet(existing.size)) { it.id }
    val merged = existing.toMutableList()
    incoming.forEach { user -> if (seen.add(user.id)) merged += user }
    return merged
}
