package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import com.wgtunnel.backend.state.BackendStatus
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel

@Immutable
data class TunnelsUiState(
    val tunnels: List<TunnelConfig> = emptyList(),
    val groups: List<TunnelGroup> = emptyList(),
    val backendStatus: BackendStatus = BackendStatus(),
    val selectedTunnels: List<TunnelConfig> = emptyList(),
    val selectedGroups: List<TunnelGroup> = emptyList(),
    val displayStates: Map<Int, DisplayTunnelState> = emptyMap(),
    val isLoading: Boolean = true,
    val isReorderMode: Boolean = false,
    val reorderScopeGroupId: Int? = null,
    val reorderLatencies: Map<Int, Double> = emptyMap(),
    val pingLatencies: Map<Int, Double> = emptyMap(),
    val managedTunnelIds: Set<Int> = emptySet(),
    val rows: List<TunnelListRow> = emptyList(),
) {
    val hasActiveTunnel: Boolean
        get() = backendStatus.activeTunnels.isNotEmpty()

    val isSelectionMode: Boolean
        get() = selectedTunnels.isNotEmpty() || selectedGroups.isNotEmpty()

    val selectedCount: Int
        get() = selectedTunnels.size + selectedGroups.size

    val canUngroup: Boolean
        get() = selectedTunnels.isNotEmpty() && selectedTunnels.none { it.groupId == null }

    val canMoveToGroup: Boolean
        get() = selectedTunnels.isNotEmpty() && selectedGroups.isEmpty()

    val tunnelsForExport: List<TunnelConfig>
        get() =
            (selectedTunnels +
                    selectedGroups.flatMap { group -> tunnels.filter { it.groupId == group.id } })
                .distinctBy { it.id }

    val reorderScopeGroup: TunnelGroup?
        get() = reorderScopeGroupId?.let { id -> groups.firstOrNull { it.id == id } }
}

fun TunnelsUiState.withComputedRows(): TunnelsUiState =
    copy(
        rows =
            buildTunnelListRows(
                groups = groups,
                tunnels = tunnels,
                activeTunnelIds = backendStatus.activeTunnels.keys,
                collapseGroups = isReorderMode && reorderScopeGroupId == null,
                scopeGroupId = if (isReorderMode) reorderScopeGroupId else null,
            ),
    )

fun List<ManagedTunnel>.toManagedTunnelIds(): Set<Int> = mapTo(mutableSetOf()) { it.tunnelId }
