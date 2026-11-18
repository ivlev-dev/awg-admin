package space.ivlev.umbravpn.core.orchestration

import space.ivlev.umbravpn.domain.model.TunnelConfig

interface ManagedTunnelAutoConnectPort {
    val activeTunnelIds: Set<Int>

    fun hasVpnPermission(): Boolean

    suspend fun startTunnel(tunnel: TunnelConfig): Boolean
}
