package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.admin.AdminAuditEntry
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminQuotaUser
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsDraft
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminTopDevice
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint

@Immutable
data class AdminAuditListState(
    val items: List<AdminAuditEntry> = emptyList(),
    val nextCursor: String? = null,
    val limit: Int = AdminAuditQuery.DEFAULT_LIMIT,
    val actor: String = "",
    val action: String = "",
    val entity: String = "",
    val period: AdminAuditPeriod = AdminAuditPeriod.All,
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val error: AdminMessage? = null,
    val isLoaded: Boolean = false,
) {
    val hasFilters: Boolean
        get() = actor.isNotBlank() || action.isNotBlank() || entity.isNotBlank()

    val hasMore: Boolean
        get() = nextCursor != null

    val canLoadMore: Boolean
        get() = hasMore && !isLoading && !isLoadingMore && error == null

    val isEmpty: Boolean
        get() = isLoaded && items.isEmpty()

    val isRefreshing: Boolean
        get() = isLoading && isLoaded

    val footer: AdminListFooter
        get() =
            when {
                !isLoaded -> AdminListFooter.None
                isLoadingMore -> AdminListFooter.Loading
                error != null -> AdminListFooter.Error
                hasMore -> AdminListFooter.LoadMore
                items.isNotEmpty() -> AdminListFooter.End
                else -> AdminListFooter.None
            }
}

@Immutable
data class AdminAuditUiState(
    val list: AdminAuditListState = AdminAuditListState(),
    val detail: AdminAuditEntry? = null,
    val accessDenied: Boolean = false,
)

@Immutable
data class AdminStatsUiState(
    val overview: AdminOverview? = null,
    val period: AdminStatsPeriod = AdminStatsPeriod.Day24,
    val series: List<AdminTrafficPoint> = emptyList(),
    val quotaUsers: List<AdminQuotaUser> = emptyList(),
    val isLoading: Boolean = false,
    val isSeriesLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isLoaded: Boolean = false,
    val error: AdminMessage? = null,
    val seriesError: AdminMessage? = null,
    val quotaError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val sumRx: Long
        get() = series.sumOf { it.rx }

    val sumTx: Long
        get() = series.sumOf { it.tx }

    val peak: Long
        get() = series.maxOfOrNull { it.rx + it.tx } ?: 0L

    val topDevices: List<AdminTopDevice>
        get() = overview?.topDevices.orEmpty().sortedByDescending { it.total }.take(TOP_LIMIT)

    val topUsers: List<AdminQuotaUser>
        get() = quotaUsers.sortedByDescending { it.usedBytes }.take(TOP_LIMIT)

    val quotaUsedBytes: Long
        get() = quotaUsers.sumOf { it.usedBytes }

    val quotaTotalBytes: Long?
        get() =
            if (quotaUsers.isEmpty() || quotaUsers.any { it.quotaBytes == null }) {
                null
            } else {
                quotaUsers.sumOf { it.quotaBytes ?: 0L }
            }

    val quotaExceededCount: Int
        get() = quotaUsers.count { it.exceeded }

    val hasTraffic: Boolean
        get() = series.any { it.rx > 0L || it.tx > 0L }

    companion object {
        const val TOP_LIMIT = 5
    }
}

@Immutable
data class AdminSettingsUiState(
    val initial: AdminPanelSettings? = null,
    val savedDraft: AdminSettingsDraft? = null,
    val draft: AdminSettingsDraft = AdminSettingsDraft(),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val isLoaded: Boolean = false,
    val isSaved: Boolean = false,
    val error: AdminMessage? = null,
    val mtuError: AdminMessage? = null,
    val jcError: AdminMessage? = null,
    val jminError: AdminMessage? = null,
    val jmaxError: AdminMessage? = null,
    val sError: AdminMessage? = null,
    val keepaliveError: AdminMessage? = null,
    val hostsError: AdminMessage? = null,
    val shareTtlError: AdminMessage? = null,
    val retentionError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isDirty: Boolean
        get() = savedDraft != null && draft != savedDraft

    val canSave: Boolean
        get() = isLoaded && isDirty && !isSaving
}
