package space.ivlev.umbravpn.viewmodel.shared

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.SelectedTunnelsRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.ui.state.DisplayTunnelState
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.state.toManagedTunnelIds
import space.ivlev.umbravpn.ui.state.withComputedRows

internal fun buildTunnelsUiStateFlow(
    scope: CoroutineScope,
    tunnelRepository: TunnelRepository,
    tunnelGroupRepository: TunnelGroupRepository,
    tunnelCoordinator: TunnelCoordinator,
    selectedTunnelsRepository: SelectedTunnelsRepository,
    managedTunnelRepository: ManagedTunnelRepository,
    reorderDraft: StateFlow<ReorderDraft?>,
    pingLatencies: StateFlow<Map<Int, Double>>,
): StateFlow<TunnelsUiState> =
    combine(
            combine(
                tunnelRepository.userTunnelsFlow,
                tunnelGroupRepository.flow,
                tunnelCoordinator.backendStatus,
                selectedTunnelsRepository.flow,
                reorderDraft,
            ) { tunnels, groups, backendStatus, selection, draft ->
                val displayStates =
                    backendStatus.activeTunnels.mapValues { (_, activeTunnel) ->
                        DisplayTunnelState.from(activeTunnel)
                    }

                TunnelsUiState(
                        tunnels = draft?.tunnels ?: tunnels,
                        groups = draft?.groups ?: groups,
                        backendStatus = backendStatus,
                        displayStates = displayStates,
                        selectedTunnels = selection.tunnels,
                        selectedGroups = selection.groups,
                        isLoading = false,
                        isReorderMode = draft != null,
                        reorderScopeGroupId = draft?.scopeGroupId,
                        reorderLatencies = draft?.latencies.orEmpty(),
                    )
                    .withComputedRows()
            },
            pingLatencies,
            managedTunnelRepository.flow,
        ) { ui, latencies, managedTunnels ->
            ui.copy(
                pingLatencies =
                    if (ui.backendStatus.activeTunnels.isEmpty()) latencies else emptyMap(),
                managedTunnelIds = managedTunnels.toManagedTunnelIds(),
            )
        }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000L), TunnelsUiState())
