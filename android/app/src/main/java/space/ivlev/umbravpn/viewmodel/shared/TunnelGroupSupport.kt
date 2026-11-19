package space.ivlev.umbravpn.viewmodel.shared

import com.dokar.sonner.ToastType
import kotlinx.coroutines.flow.firstOrNull
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.SelectedTunnelsRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.state.nextChildPosition
import space.ivlev.umbravpn.ui.state.shiftRootPositionsBy
import space.ivlev.umbravpn.ui.state.ungroupKeepingOrder
import space.ivlev.umbravpn.ui.state.uniqueDisplayName
import space.ivlev.umbravpn.util.StringValue

internal class TunnelGroupSupport(
    private val tunnelRepository: TunnelRepository,
    private val tunnelGroupRepository: TunnelGroupRepository,
    private val selectedTunnelsRepository: SelectedTunnelsRepository,
    private val tunnelCoordinator: TunnelCoordinator,
    private val globalEffectRepository: GlobalEffectRepository,
) {
    suspend fun createAndMoveSelected(ui: TunnelsUiState, name: String) {
        val selected = ui.selectedTunnels
        if (selected.isEmpty()) return
        val unique = uniqueDisplayName(name, ui.groups.map { it.name }, "Group")
        // New groups land at the top
        val (shiftedGroups, shiftedTunnels) = shiftRootPositionsBy(ui.groups, ui.tunnels, 1)
        tunnelGroupRepository.saveAll(shiftedGroups)
        if (shiftedTunnels.isNotEmpty()) tunnelRepository.updateAll(shiftedTunnels)
        val groupId =
            tunnelGroupRepository.save(TunnelGroup(name = unique, position = 0, expanded = true))
        moveToGroup(groupId, selected, ui.tunnels)
    }

    suspend fun rename(ui: TunnelsUiState, group: TunnelGroup, name: String) {
        val unique =
            uniqueDisplayName(
                name,
                ui.groups.filter { it.id != group.id }.map { it.name },
                "Group",
            )
        tunnelGroupRepository.save(group.copy(name = unique))
    }

    suspend fun toggleExpanded(group: TunnelGroup) {
        tunnelGroupRepository.setExpanded(group.id, !group.expanded)
    }

    suspend fun ungroup(ui: TunnelsUiState, group: TunnelGroup) {
        val (groups, tunnels) = ungroupKeepingOrder(ui.groups, ui.tunnels, group.id)
        val changedTunnels = changedTunnelsFrom(ui.tunnels, tunnels)
        if (changedTunnels.isNotEmpty()) tunnelRepository.updateAll(changedTunnels)
        tunnelGroupRepository.saveAll(groups)
        tunnelGroupRepository.delete(group)
        selectedTunnelsRepository.clear()
    }

    suspend fun deleteWithTunnels(ui: TunnelsUiState, group: TunnelGroup) {
        val children = ui.tunnels.filter { it.groupId == group.id }
        val activeTunIds =
            tunnelCoordinator.backendStatus.firstOrNull()?.activeTunnels?.map { it.key }
        if (children.any { activeTunIds?.contains(it.id) == true }) {
            globalEffectRepository.post(
                GlobalSideEffect.Snackbar(
                    StringValue.StringResource(R.string.delete_active_message),
                    ToastType.Error,
                ),
            )
            return
        }
        if (children.isNotEmpty()) tunnelRepository.delete(children)
        tunnelGroupRepository.delete(group)
        selectedTunnelsRepository.clear()
    }

    suspend fun moveSelectedToGroup(ui: TunnelsUiState, groupId: Int) {
        if (ui.selectedTunnels.isEmpty()) return
        moveToGroup(groupId, ui.selectedTunnels, ui.tunnels)
    }

    private suspend fun moveToGroup(
        groupId: Int,
        selected: List<TunnelConfig>,
        all: List<TunnelConfig>,
    ) {
        var next = nextChildPosition(all, groupId)
        val ids = selected.map { it.id }.toSet()
        tunnelRepository.updateAll(
            all.filter { it.id in ids }.map { it.copy(groupId = groupId, position = next++) },
        )
        selectedTunnelsRepository.clear()
    }
}
