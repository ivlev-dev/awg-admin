package space.ivlev.umbravpn.ui.state

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel

class TunnelsUiStateTest {

    @Test
    fun managedIdsMarkPrimaryAndSecondaryTunnels() {
        val state =
            TunnelsUiState(
                tunnels =
                    listOf(
                        tunnel(id = 1, name = "Pixel", position = 0),
                        tunnel(id = 2, name = "Pixel · awg1", position = 1),
                        tunnel(id = 3, name = "Manual", position = 2),
                    ),
                managedTunnelIds = setOf(1, 2),
            )

        assertTrue(1 in state.managedTunnelIds)
        assertTrue(2 in state.managedTunnelIds)
        assertFalse(3 in state.managedTunnelIds)
        assertEquals(
            listOf(1, 2, 3),
            state.rows.filterIsInstance<TunnelListRow.TunnelRow>().map { it.tunnel.id },
        )
    }

    @Test
    fun defaultStateHasNoManagedTunnels() {
        assertTrue(TunnelsUiState().managedTunnelIds.isEmpty())
    }

    @Test
    fun repositoryBindingsMapToManagedTunnelIds() {
        val bindings =
            listOf(
                managedTunnel(tunnelId = 5),
                managedTunnel(tunnelId = 6),
                managedTunnel(tunnelId = 5),
            )

        assertEquals(setOf(5, 6), bindings.toManagedTunnelIds())
    }

    private fun managedTunnel(tunnelId: Int): ManagedTunnel =
        ManagedTunnel(
            deviceId = "device-1",
            tunnelId = tunnelId,
            deviceName = "Pixel",
            interfaceId = "iface-1",
            endpoint = "vpn.example.com:51820",
            revision = "rev-1",
            syncedAt = 1L,
        )

    private fun tunnel(id: Int, name: String, position: Int): TunnelConfig =
        TunnelConfig(id = id, name = name, quickConfig = "", position = position)
}
