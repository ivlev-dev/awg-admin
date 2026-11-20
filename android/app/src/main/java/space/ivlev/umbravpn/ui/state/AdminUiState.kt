package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminCatalogs
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminRoleFilter
import space.ivlev.umbravpn.domain.model.admin.AdminStatusFilter
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab

@Immutable
data class AdminHubUiState(
    val overview: AdminOverview? = null,
    val pendingUsers: Int = 0,
    val retentionDays: Int? = null,
    val recentAudit: Int? = null,
    val hasMoreAudit: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val accessDenied: Boolean = false,
)

enum class AdminListFooter {
    None,
    Loading,
    Error,
    LoadMore,
    End,
}

@Immutable
data class AdminUsersState(
    val items: List<AdminUser> = emptyList(),
    val total: Int = 0,
    val limit: Int = AdminUserQuery.DEFAULT_LIMIT,
    val offset: Int = 0,
    val query: String = "",
    val tab: AdminUserTab = AdminUserTab.Active,
    val role: AdminRoleFilter = AdminRoleFilter.All,
    val status: AdminStatusFilter = AdminStatusFilter.All,
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val error: AdminMessage? = null,
    val isLoaded: Boolean = false,
) {
    val hasMore: Boolean
        get() = isLoaded && items.size < total

    val canLoadMore: Boolean
        get() = hasMore && !isLoading && !isLoadingMore && error == null

    val isEmpty: Boolean
        get() = isLoaded && items.isEmpty()

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

sealed interface AdminUserDialog {
    data class Delete(val id: String, val email: String) : AdminUserDialog

    data class ResetPassword(val id: String, val email: String) : AdminUserDialog

    data class Approve(val id: String, val email: String) : AdminUserDialog

    data class Reject(val id: String, val email: String) : AdminUserDialog

    data class SetDisabled(
        val id: String,
        val email: String,
        val disabled: Boolean,
    ) : AdminUserDialog
}

@Immutable
data class AdminUsersUiState(
    val list: AdminUsersState = AdminUsersState(),
    val dialog: AdminUserDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val tariffs: List<AdminTariff> = emptyList(),
    val isLoadingTariffs: Boolean = false,
    val accessDenied: Boolean = false,
)

sealed interface AdminTariffDialog {
    data class Delete(val id: String, val name: String) : AdminTariffDialog
}

@Immutable
data class AdminTariffsUiState(
    val items: List<AdminTariff> = emptyList(),
    val isLoaded: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val dialog: AdminTariffDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val accessDenied: Boolean = false,
)

@Immutable
data class AdminUserFormUiState(
    val id: String? = null,
    val email: String = "",
    val fullName: String = "",
    val password: String = "",
    val role: UserRole = UserRole.User,
    val tariffId: String? = null,
    val nodeId: String? = null,
    val groupId: String? = null,
    val disabled: Boolean = false,
    val catalogs: AdminCatalogs = AdminCatalogs(),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val emailError: AdminMessage? = null,
    val passwordError: AdminMessage? = null,
    val fullNameError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isEditing: Boolean
        get() = id != null
}

sealed interface AdminFormSideEffect {
    data object Saved : AdminFormSideEffect
}

@Immutable
data class AdminTariffFormUiState(
    val id: String? = null,
    val name: String = "",
    val description: String = "",
    val maxDevices: String = "1",
    val deviceDownKbps: String = "0",
    val deviceUpKbps: String = "0",
    val quotaGb: String = "",
    val interfaceId: String? = null,
    val interfaces: List<AdminOption> = emptyList(),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val nameError: AdminMessage? = null,
    val maxDevicesError: AdminMessage? = null,
    val speedError: AdminMessage? = null,
    val quotaError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isEditing: Boolean
        get() = id != null
}
