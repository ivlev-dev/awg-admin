package space.ivlev.umbravpn.viewmodel.shared

import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup

internal data class ReorderDraft(
    val tunnels: List<TunnelConfig>,
    val groups: List<TunnelGroup>,
    val scopeGroupId: Int?,
    val sortAscending: Boolean? = null,
    val originalTunnels: List<TunnelConfig>,
    val originalGroups: List<TunnelGroup>,
    val latencies: Map<Int, Double> = emptyMap(),
)

internal fun changedTunnelsFrom(
    before: List<TunnelConfig>,
    after: List<TunnelConfig>,
): List<TunnelConfig> {
    val beforeById = before.associateBy { it.id }
    return after.filter { tunnel ->
        val prior = beforeById[tunnel.id]
        prior == null || prior.position != tunnel.position || prior.groupId != tunnel.groupId
    }
}
