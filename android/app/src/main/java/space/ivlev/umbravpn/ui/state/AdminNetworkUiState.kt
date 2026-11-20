package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.admin.AdminGroup
import space.ivlev.umbravpn.domain.model.admin.AdminInterface
import space.ivlev.umbravpn.domain.model.admin.AdminNode
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminPool
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode

@Immutable
data class AdminTokenReveal(
    val nodeName: String,
    val token: String,
    val reason: AdminTokenReason,
)

enum class AdminTokenReason {
    Created,
    Rotated,
}

sealed interface AdminNodeDialog {
    data class Delete(val id: String, val name: String) : AdminNodeDialog

    data class Rotate(val id: String, val name: String) : AdminNodeDialog
}

@Immutable
data class AdminNodesUiState(
    val items: List<AdminNode> = emptyList(),
    val isLoaded: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val dialog: AdminNodeDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val revealedToken: AdminTokenReveal? = null,
    val accessDenied: Boolean = false,
)

@Immutable
data class AdminNodeFormUiState(
    val name: String = "",
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val nameError: AdminMessage? = null,
    val revealedToken: AdminTokenReveal? = null,
    val created: Boolean = false,
    val accessDenied: Boolean = false,
)

sealed interface AdminInterfaceDialog {
    data class Delete(val id: String, val name: String) : AdminInterfaceDialog

    data class Rotate(val id: String, val name: String) : AdminInterfaceDialog
}

@Immutable data class AdminInterfaceReveal(val name: String, val publicKey: String)

@Immutable
data class AdminInterfacesUiState(
    val items: List<AdminInterface> = emptyList(),
    val nodes: List<AdminOption> = emptyList(),
    val groups: List<AdminOption> = emptyList(),
    val nodeFilter: String? = null,
    val groupFilter: String? = null,
    val isLoaded: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val dialog: AdminInterfaceDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val revealedKey: AdminInterfaceReveal? = null,
    val accessDenied: Boolean = false,
) {
    val filtered: List<AdminInterface>
        get() = items.filter { item ->
            (nodeFilter == null || item.nodeId == nodeFilter) &&
                (groupFilter == null || item.groupId == groupFilter)
        }
}

@Immutable
data class AdminInterfaceFormUiState(
    val id: String? = null,
    val groupId: String? = null,
    val nodeId: String? = null,
    val name: String = "",
    val label: String = "",
    val endpointHost: String = "",
    val endpointPort: String = "51820",
    val listenPort: String = "51820",
    val mtu: String = "1420",
    val enabled: Boolean = true,
    val nodes: List<AdminOption> = emptyList(),
    val groups: List<AdminOption> = emptyList(),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val nameError: AdminMessage? = null,
    val hostError: AdminMessage? = null,
    val endpointPortError: AdminMessage? = null,
    val listenPortError: AdminMessage? = null,
    val mtuError: AdminMessage? = null,
    val groupError: AdminMessage? = null,
    val nodeError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isEditing: Boolean
        get() = id != null
}

sealed interface AdminGroupDialog {
    data class Delete(
        val id: String,
        val name: String,
        val interfaces: Int,
        val devices: Int,
    ) : AdminGroupDialog
}

@Immutable
data class AdminGroupsUiState(
    val items: List<AdminGroup> = emptyList(),
    val isLoaded: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val dialog: AdminGroupDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val accessDenied: Boolean = false,
)

@Immutable
data class AdminGroupFormUiState(
    val id: String? = null,
    val name: String = "",
    val description: String = "",
    val baseCidr: String = "",
    val forwardingDefault: Boolean = false,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val nameError: AdminMessage? = null,
    val cidrError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isEditing: Boolean
        get() = id != null
}

sealed interface AdminPoolDialog {
    data class Delete(val id: String, val name: String) : AdminPoolDialog
}

@Immutable
data class AdminPoolsUiState(
    val groupId: String = "",
    val groupName: String = "",
    val items: List<AdminPool> = emptyList(),
    val isLoaded: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AdminMessage? = null,
    val dialog: AdminPoolDialog? = null,
    val dialogError: AdminMessage? = null,
    val isActionInProgress: Boolean = false,
    val accessDenied: Boolean = false,
)

@Immutable
data class AdminPoolFormUiState(
    val groupId: String = "",
    val id: String? = null,
    val name: String = "",
    val cidr: String = "",
    val gateway: String = "",
    val mode: AdminPoolMode = AdminPoolMode.Auto,
    val enabled: Boolean = true,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: AdminMessage? = null,
    val nameError: AdminMessage? = null,
    val cidrError: AdminMessage? = null,
    val gatewayError: AdminMessage? = null,
    val accessDenied: Boolean = false,
) {
    val isEditing: Boolean
        get() = id != null
}
