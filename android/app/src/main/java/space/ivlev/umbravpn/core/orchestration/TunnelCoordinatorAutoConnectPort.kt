package space.ivlev.umbravpn.core.orchestration

import space.ivlev.umbravpn.domain.enums.TunnelActionSource
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.service.ServiceManager

class TunnelCoordinatorAutoConnectPort(
    private val tunnelCoordinator: TunnelCoordinator,
    private val serviceManager: ServiceManager,
) : ManagedTunnelAutoConnectPort {

    override val activeTunnelIds: Set<Int>
        get() = tunnelCoordinator.backendStatus.value.activeTunnels.keys

    override fun hasVpnPermission(): Boolean = serviceManager.hasVpnPermission()

    override suspend fun startTunnel(tunnel: TunnelConfig): Boolean {
        tunnelCoordinator.startTunnel(tunnel, TunnelActionSource.AUTO_TUNNEL)
        return tunnelCoordinator.backendStatus.value.activeTunnels.containsKey(tunnel.id)
    }
}
