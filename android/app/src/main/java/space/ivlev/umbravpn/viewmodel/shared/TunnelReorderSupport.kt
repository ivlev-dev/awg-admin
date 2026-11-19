package space.ivlev.umbravpn.viewmodel.shared

import com.dokar.sonner.ToastType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.sortGroupChildrenByName
import space.ivlev.umbravpn.ui.state.sortRootByName
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.network.NetworkUtils

internal class TunnelReorderSupport(
    private val tunnelRepository: TunnelRepository,
    private val tunnelGroupRepository: TunnelGroupRepository,
    private val networkUtils: NetworkUtils,
    private val tunnelCoordinator: TunnelCoordinator,
    private val globalEffectRepository: GlobalEffectRepository,
) {
    private val _draft = MutableStateFlow<ReorderDraft?>(null)
    val draft: StateFlow<ReorderDraft?> = _draft.asStateFlow()

    private val _latencies = MutableStateFlow<Map<Int, Double>>(emptyMap())
    val latencies: StateFlow<Map<Int, Double>> = _latencies.asStateFlow()

    private val pingInFlight = MutableStateFlow(false)

    fun clearLatencies() {
        _latencies.value = emptyMap()
    }

    fun enter(tunnels: List<TunnelConfig>, groups: List<TunnelGroup>) {
        _draft.value =
            ReorderDraft(
                tunnels = tunnels,
                groups = groups,
                scopeGroupId = null,
                originalTunnels = tunnels,
                originalGroups = groups,
            )
    }

    fun cancel() {
        _draft.value = null
    }

    fun exitScope() {
        _draft.update { draft -> draft?.copy(scopeGroupId = null, sortAscending = null) }
    }

    fun enterScope(groupId: Int) {
        _draft.update { draft -> draft?.copy(scopeGroupId = groupId, sortAscending = null) }
    }

    fun applyDraft(groups: List<TunnelGroup>, tunnels: List<TunnelConfig>) {
        _draft.update { draft -> draft?.copy(groups = groups, tunnels = tunnels) }
    }

    suspend fun save() {
        val draft = _draft.value ?: return
        tunnelGroupRepository.saveAll(draft.groups)
        val changedTunnels = changedTunnelsFrom(draft.originalTunnels, draft.tunnels)
        if (changedTunnels.isNotEmpty()) tunnelRepository.updateAll(changedTunnels)
        _draft.value = null
        globalEffectRepository.post(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.config_changes_saved),
                ToastType.Success,
            ),
        )
    }

    fun sortByName() {
        val draft = _draft.value ?: return
        val nextAscending =
            when (draft.sortAscending) {
                null -> true
                true -> false
                false -> null
            }
        if (nextAscending == null) {
            _draft.value =
                draft.copy(
                    tunnels = draft.originalTunnels,
                    groups = draft.originalGroups,
                    sortAscending = null,
                )
            return
        }
        val (groups, tunnels) =
            if (draft.scopeGroupId != null) {
                draft.groups to
                    sortGroupChildrenByName(draft.tunnels, draft.scopeGroupId, nextAscending)
            } else {
                sortRootByName(draft.groups, draft.tunnels, nextAscending)
            }
        _draft.value = draft.copy(tunnels = tunnels, groups = groups, sortAscending = nextAscending)
    }

    suspend fun sortByLatency() {
        val draft = _draft.value ?: return
        if (pingInFlight.value) return
        pingInFlight.value = true
        globalEffectRepository.post(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.pinging_servers),
                ToastType.Info,
            ),
        )
        try {
            val scopeId = draft.scopeGroupId
            val targets =
                if (scopeId != null) draft.tunnels.filter { it.groupId == scopeId }
                else draft.tunnels.filter { it.groupId == null }
            val results = pingSorted(targets)
            val ordered = results.map { it.first }
            val tunnels =
                if (scopeId != null) {
                    val others = draft.tunnels.filter { it.groupId != scopeId }
                    others + ordered.mapIndexed { index, tunnel -> tunnel.copy(position = index) }
                } else {
                    val grouped = draft.tunnels.filter { it.groupId != null }
                    val slots =
                        draft.tunnels
                            .filter { it.groupId == null }
                            .sortedBy { it.position }
                            .map { it.position }
                    val rewritten = ordered.mapIndexed { index, tunnel ->
                        tunnel.copy(position = slots.getOrElse(index) { tunnel.position })
                    }
                    grouped + rewritten
                }
            val measured = results.associate { (tunnel, ms) -> tunnel.id to ms }
            _draft.value =
                draft.copy(
                    tunnels = tunnels,
                    sortAscending = null,
                    latencies = draft.latencies + measured,
                )
            if (tunnelCoordinator.backendStatus.first().activeTunnels.isEmpty()) {
                _latencies.value = _latencies.value + measured
            }
        } finally {
            pingInFlight.value = false
        }
    }

    suspend fun pingAll() {
        if (pingInFlight.value) return
        if (tunnelCoordinator.backendStatus.first().activeTunnels.isNotEmpty()) return
        pingInFlight.value = true
        globalEffectRepository.post(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.pinging_servers),
                ToastType.Info,
            ),
        )
        try {
            val results = pingSorted(tunnelRepository.userTunnelsFlow.first())
            if (tunnelCoordinator.backendStatus.first().activeTunnels.isEmpty()) {
                _latencies.value = results.associate { (tunnel, ms) -> tunnel.id to ms }
            }
        } finally {
            pingInFlight.value = false
        }
    }

    private suspend fun pingSorted(
        tunnels: List<TunnelConfig>,
    ): List<Pair<TunnelConfig, Double>> {
        return withContext(Dispatchers.IO) {
            tunnels
                .map { tunnel ->
                    async {
                        val config =
                            try {
                                tunnel.getConfig()
                            } catch (_: Exception) {
                                null
                            }
                        val endpoint = config?.peers?.firstOrNull()?.host
                        val latency =
                            if (endpoint != null) {
                                try {
                                    // 3 pings, a single dropped packet on an otherwise reachable
                                    // server would otherwise show as unreachable. Each tunnel is
                                    // pinged concurrently, so this doesn't multiply by tunnel count
                                    val stats = networkUtils.pingWithStats(endpoint, 3)
                                    if (stats.isReachable) stats.rttAvg else Double.MAX_VALUE
                                } catch (_: Exception) {
                                    Double.MAX_VALUE
                                }
                            } else {
                                Double.MAX_VALUE
                            }
                        tunnel to latency
                    }
                }
                .awaitAll()
                .sortedBy { it.second }
        }
    }
}
