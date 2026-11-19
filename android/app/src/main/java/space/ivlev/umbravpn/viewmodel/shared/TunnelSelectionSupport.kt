package space.ivlev.umbravpn.viewmodel.shared

import com.dokar.sonner.ToastType
import kotlinx.coroutines.flow.firstOrNull
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.SelectedTunnelsRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelsSelection
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.state.nextRootPosition
import space.ivlev.umbravpn.ui.state.ungroupKeepingOrder
import space.ivlev.umbravpn.util.StringValue

internal class TunnelSelectionSupport(
    private val tunnelRepository: TunnelRepository,
    private val tunnelGroupRepository: TunnelGroupRepository,
    private val selectedTunnelsRepository: SelectedTunnelsRepository,
    private val tunnelCoordinator: TunnelCoordinator,
    private val globalEffectRepository: GlobalEffectRepository,
) {
    fun toggleSelectAll(ui: TunnelsUiState) {
        val allSelected =
            ui.selectedTunnels.size == ui.tunnels.size && ui.selectedGroups.size == ui.groups.size
        if (allSelected) {
            selectedTunnelsRepository.clear()
        } else {
            selectedTunnelsRepository.set(
                TunnelsSelection(tunnels = ui.tunnels, groups = ui.groups),
            )
        }
    }

    fun clear() {
        selectedTunnelsRepository.clear()
    }

    fun toggleTunnel(ui: TunnelsUiState, tunnelId: Int) {
        val selectedTuns =
            ui.selectedTunnels.toMutableList().apply {
                val removed = removeIf { it.id == tunnelId }
                if (!removed) addAll(ui.tunnels.filter { it.id == tunnelId })
            }
        selectedTunnelsRepository.set(
            TunnelsSelection(tunnels = selectedTuns, groups = ui.selectedGroups),
        )
    }

    fun toggleGroup(ui: TunnelsUiState, groupId: Int) {
        val selectedGroups =
            ui.selectedGroups.toMutableList().apply {
                val removed = removeIf { it.id == groupId }
                if (!removed) addAll(ui.groups.filter { it.id == groupId })
            }
        selectedTunnelsRepository.set(
            TunnelsSelection(tunnels = ui.selectedTunnels, groups = selectedGroups),
        )
    }

    suspend fun deleteSelected(ui: TunnelsUiState) {
        val activeTunIds =
            tunnelCoordinator.backendStatus.firstOrNull()?.activeTunnels?.map { it.key }.orEmpty()
        val selectedTuns = ui.selectedTunnels
        if (selectedTuns.any { activeTunIds.contains(it.id) }) {
            globalEffectRepository.post(
                GlobalSideEffect.Snackbar(
                    StringValue.StringResource(R.string.delete_active_message),
                    ToastType.Error,
                ),
            )
            return
        }
        if (selectedTuns.isNotEmpty()) tunnelRepository.delete(selectedTuns)
        var groups = ui.groups
        val beforeUngroup = ui.tunnels.filter { tun -> selectedTuns.none { it.id == tun.id } }
        var tunnels = beforeUngroup
        ui.selectedGroups.forEach { group ->
            val result = ungroupKeepingOrder(groups, tunnels, group.id)
            groups = result.first
            tunnels = result.second
            tunnelGroupRepository.delete(group)
        }
        if (ui.selectedGroups.isNotEmpty()) {
            val changedTunnels = changedTunnelsFrom(beforeUngroup, tunnels)
            if (changedTunnels.isNotEmpty()) tunnelRepository.updateAll(changedTunnels)
            tunnelGroupRepository.saveAll(groups)
        }
        clear()
    }

    // Releases only the selected tunnels from their groups
    suspend fun ungroupSelected(ui: TunnelsUiState) {
        if (!ui.canUngroup) return
        var next = nextRootPosition(ui.groups, ui.tunnels)
        val ids = ui.selectedTunnels.map { it.id }.toSet()
        val tunnels =
            ui.tunnels.filter { it.id in ids }.map { it.copy(groupId = null, position = next++) }
        if (tunnels.isNotEmpty()) tunnelRepository.updateAll(tunnels)
        clear()
    }
}
