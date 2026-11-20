package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminAuditEntry
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminAuditUiState

class AdminAuditViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val now: () -> Instant = { Instant.now() },
) : OrbitContainerHost<AdminAuditUiState, AdminAuditUiState, Nothing>, ViewModel() {

    private var searchJob: Job? = null
    private var requestSeq = 0

    override val container =
        orbitContainer<AdminAuditUiState, Nothing>(AdminAuditUiState()) {
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

    fun retry() = intent {
        reduce { state.copy(list = state.list.copy(error = null)) }
        loadPage(reset = true)
    }

    fun loadMore() = intent {
        if (!state.list.canLoadMore) return@intent
        loadPage(reset = false)
    }

    fun setActor(value: String) = intent {
        if (state.list.actor == value) return@intent
        reduce {
            state.copy(
                list = state.list.copy(actor = value, nextCursor = null, error = null),
            )
        }
        scheduleSearch()
    }

    fun setAction(value: String) = intent {
        if (state.list.action == value) return@intent
        reduce {
            state.copy(
                list = state.list.copy(action = value, nextCursor = null, error = null),
            )
        }
        scheduleSearch()
    }

    fun setEntity(value: String) = intent {
        if (state.list.entity == value) return@intent
        reduce {
            state.copy(
                list = state.list.copy(entity = value, nextCursor = null, error = null),
            )
        }
        scheduleSearch()
    }

    fun setPeriod(period: AdminAuditPeriod) = intent {
        if (state.list.period == period) return@intent
        searchJob?.cancel()
        reduce {
            state.copy(
                list =
                    state.list.copy(
                        period = period,
                        items = emptyList(),
                        nextCursor = null,
                        isLoaded = false,
                        error = null,
                    ),
            )
        }
        loadPage(reset = true)
    }

    fun clearFilters() = intent {
        searchJob?.cancel()
        reduce {
            state.copy(
                list =
                    state.list.copy(
                        actor = "",
                        action = "",
                        entity = "",
                        period = AdminAuditPeriod.All,
                        items = emptyList(),
                        nextCursor = null,
                        isLoaded = false,
                        error = null,
                    ),
            )
        }
        loadPage(reset = true)
    }

    fun select(entry: AdminAuditEntry) = intent { reduce { state.copy(detail = entry) } }

    fun dismissDetail() = intent { reduce { state.copy(detail = null) } }

    private suspend fun Syntax<AdminAuditUiState, Nothing>.scheduleSearch() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            intent { loadPage(reset = true) }
        }
    }

    private suspend fun Syntax<AdminAuditUiState, Nothing>.loadPage(reset: Boolean) {
        val current = state.list
        if (!reset && !current.canLoadMore) return
        val window = current.period.windowSeconds
        val currentNow = if (window != null) now() else null
        val query =
            AdminAuditQuery(
                limit = current.limit,
                before = if (reset) null else current.nextCursor,
                actor = current.actor,
                action = current.action,
                entity = current.entity,
                from = window?.let { currentNow?.minusSeconds(it) },
                to = currentNow,
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
        when (val result = repository.audit(query)) {
            is AccountResult.Success ->
                reduce {
                    if (seq != requestSeq) {
                        state
                    } else {
                        val page = result.value
                        val items =
                            if (reset) {
                                page.items.distinctBy { it.id }
                            } else {
                                mergeAudit(state.list.items, page.items)
                            }
                        state.copy(
                            list =
                                state.list.copy(
                                    items = items,
                                    nextCursor = page.nextCursor,
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
                    if (seq != requestSeq) {
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

private fun mergeAudit(
    existing: List<AdminAuditEntry>,
    incoming: List<AdminAuditEntry>,
): List<AdminAuditEntry> {
    if (incoming.isEmpty()) return existing
    val seen = existing.mapTo(HashSet(existing.size)) { it.id }
    val merged = existing.toMutableList()
    incoming.forEach { entry -> if (seen.add(entry.id)) merged += entry }
    return merged
}
