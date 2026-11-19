package space.ivlev.umbravpn.viewmodel.shared

import space.ivlev.umbravpn.ui.state.TunnelsUiState

internal data class TunnelsChrome(
    val loading: Boolean,
    val selectedTunCount: Int,
    val canMoveToGroup: Boolean,
    val isReorderMode: Boolean,
    val reorderScopeTitle: String?,
    val hasGroups: Boolean,
    val canReorder: Boolean,
    val hasActiveTunnel: Boolean,
)

internal fun TunnelsUiState.toChrome(): TunnelsChrome =
    TunnelsChrome(
        loading = isLoading,
        selectedTunCount = selectedCount,
        canMoveToGroup = canMoveToGroup,
        isReorderMode = isReorderMode,
        reorderScopeTitle = reorderScopeGroup?.name,
        hasGroups = groups.isNotEmpty(),
        canReorder = tunnels.size + groups.size > 1,
        hasActiveTunnel = hasActiveTunnel,
    )
