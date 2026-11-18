package space.ivlev.umbravpn.ui.tunnels

import com.wgtunnel.backend.Tunnel
import com.wgtunnel.backend.state.ActiveTunnel
import com.wgtunnel.backend.state.BootstrapState
import org.junit.Assert.assertEquals
import org.junit.Test
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.state.DisplayTunnelState
import space.ivlev.umbravpn.ui.theme.StatusKind

class DisplayTunnelStateTest {

    @Test
    fun everyStateHasDistinctLocalizedLabel() {
        val states =
            listOf(
                DisplayTunnelState.Disconnected,
                DisplayTunnelState.ResolvingDns,
                DisplayTunnelState.EstablishingConnection,
                DisplayTunnelState.Connected,
                DisplayTunnelState.HandshakeFailure,
            )

        assertEquals(states.size, states.map { it.labelRes() }.distinct().size)
        assertEquals(R.string.tunnel_state_connected, DisplayTunnelState.Connected.labelRes())
        assertEquals(
            R.string.tunnel_state_disconnected,
            DisplayTunnelState.Disconnected.labelRes(),
        )
        assertEquals(
            R.string.tunnel_state_handshake_failure,
            DisplayTunnelState.HandshakeFailure.labelRes(),
        )
    }

    @Test
    fun statusKindsMatchSeverity() {
        assertEquals(StatusKind.SUCCESS, DisplayTunnelState.Connected.statusKind())
        assertEquals(StatusKind.WARNING, DisplayTunnelState.EstablishingConnection.statusKind())
        assertEquals(StatusKind.WARNING, DisplayTunnelState.ResolvingDns.statusKind())
        assertEquals(StatusKind.ERROR, DisplayTunnelState.HandshakeFailure.statusKind())
        assertEquals(StatusKind.NEUTRAL, DisplayTunnelState.Disconnected.statusKind())
    }

    @Test
    fun mapsBackendStates() {
        assertEquals(
            DisplayTunnelState.Disconnected,
            DisplayTunnelState.from(ActiveTunnel(transportState = Tunnel.State.Down)),
        )
        assertEquals(
            DisplayTunnelState.HandshakeFailure,
            DisplayTunnelState.from(
                ActiveTunnel(
                    transportState = Tunnel.State.Up.HandshakeFailure,
                    bootstrapState = BootstrapState.Failed(),
                ),
            ),
        )
        assertEquals(
            DisplayTunnelState.Connected,
            DisplayTunnelState.from(
                ActiveTunnel(transportState = Tunnel.State.Up.Healthy),
            ),
        )
    }
}
