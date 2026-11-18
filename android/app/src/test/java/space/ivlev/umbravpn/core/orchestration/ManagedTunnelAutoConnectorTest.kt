package space.ivlev.umbravpn.core.orchestration

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.sync.FakeManagedTunnelRepository
import space.ivlev.umbravpn.sync.InMemoryTunnelRepository
import space.ivlev.umbravpn.sync.activeSession

@OptIn(ExperimentalCoroutinesApi::class)
class ManagedTunnelAutoConnectorTest {

    @Test
    fun inactiveSessionDoesNotConnect() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
                session = SessionState.LoggedOut,
            )

        env.connector.ensureConnected()

        assertTrue(env.port.started.isEmpty())
        assertNull(env.connector.pendingTunnelId)
    }

    @Test
    fun noManagedTunnelsDoesNotConnect() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = emptyList(),
            )

        env.connector.ensureConnected()

        assertTrue(env.port.started.isEmpty())
    }

    @Test
    fun activeTunnelIsNotReplaced() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
                activeTunnelIds = setOf(99),
            )

        env.connector.ensureConnected()

        assertTrue(env.port.started.isEmpty())
    }

    @Test
    fun selectsBindingWithLowestTunnelPositionSkippingMissingTunnels() = runTest {
        val env =
            TestEnvironment(
                tunnels =
                    listOf(
                        tunnel(id = 10, position = 5),
                        tunnel(id = 11, position = 2),
                        tunnel(id = 12, position = 4),
                    ),
                bindings =
                    listOf(
                        binding(deviceId = "device-10", tunnelId = 10),
                        binding(deviceId = "device-11", tunnelId = 11),
                        binding(deviceId = "device-missing", tunnelId = 99),
                        binding(deviceId = "device-12", tunnelId = 12),
                    ),
            )

        env.connector.ensureConnected()

        assertEquals(listOf(11), env.port.started.map { it.id })
    }

    @Test
    fun missingPermissionEmitsEventAndConnectsAfterGrant() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
                hasVpnPermission = false,
            )
        val events = mutableListOf<AutoConnectEvent>()
        val job =
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
                env.connector.events.collect { events += it }
            }

        env.connector.ensureConnected()
        runCurrent()

        assertTrue(env.port.started.isEmpty())
        assertEquals(listOf<AutoConnectEvent>(AutoConnectEvent.NeedsPermission(1)), events)
        assertEquals(1, env.connector.pendingTunnelId)

        env.port.hasVpnPermission = true
        env.connector.onPermissionGranted()
        runCurrent()

        assertEquals(listOf(1), env.port.started.map { it.id })
        assertEquals(AutoConnectEvent.Connected(1), events.last())
        assertNull(env.connector.pendingTunnelId)
        job.cancel()
    }

    @Test
    fun deniedPermissionResetsPendingTunnel() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
                hasVpnPermission = false,
            )

        env.connector.ensureConnected()
        assertEquals(1, env.connector.pendingTunnelId)

        env.connector.reset()
        env.connector.onPermissionGranted()

        assertTrue(env.port.started.isEmpty())
        assertNull(env.connector.pendingTunnelId)
    }

    @Test
    fun repeatedEnsureConnectedAfterSuccessIsIgnored() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
            )

        env.connector.ensureConnected()
        env.port.active.clear()
        env.connector.ensureConnected()

        assertEquals(listOf(1), env.port.started.map { it.id })
    }

    @Test
    fun manualDisconnectPreventsAutoConnectInSameProcess() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
                activeTunnelIds = setOf(42),
            )

        env.connector.ensureConnected()
        assertTrue(env.port.started.isEmpty())

        env.port.active.clear()
        env.connector.onManualDisconnect()
        env.connector.ensureConnected()

        assertTrue(env.port.started.isEmpty())
    }

    @Test
    fun resetAllowsAutoConnectAgain() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
            )

        env.connector.ensureConnected()
        env.port.active.clear()
        env.connector.reset()
        env.connector.ensureConnected()

        assertEquals(listOf(1, 1), env.port.started.map { it.id })
    }

    @Test
    fun failedStartCanBeRetried() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
            )
        env.port.startSucceeds = false

        env.connector.ensureConnected()
        assertTrue(env.port.active.isEmpty())

        env.port.startSucceeds = true
        env.connector.ensureConnected()

        assertEquals(listOf(1, 1), env.port.started.map { it.id })
        assertTrue(env.port.active.contains(1))
    }

    @Test
    fun autoConnectDisabledDoesNothing() = runTest {
        val env =
            TestEnvironment(
                tunnels = listOf(tunnel(id = 1, position = 0)),
                bindings = listOf(binding(deviceId = "device-1", tunnelId = 1)),
            )

        env.connector.ensureConnected(autoConnect = false)

        assertTrue(env.port.started.isEmpty())
    }

    private class TestEnvironment(
        tunnels: List<TunnelConfig>,
        bindings: List<ManagedTunnel>,
        session: SessionState = activeSession,
        hasVpnPermission: Boolean = true,
        activeTunnelIds: Set<Int> = emptySet(),
    ) {
        val sessionState = MutableStateFlow(session)
        val port = FakeAutoConnectPort(hasVpnPermission, activeTunnelIds)
        val connector =
            ManagedTunnelAutoConnector(
                session = sessionState,
                managedTunnelRepository = FakeManagedTunnelRepository(bindings),
                tunnelRepository = InMemoryTunnelRepository(tunnels),
                port = port,
            )
    }

    private class FakeAutoConnectPort(
        var hasVpnPermission: Boolean = true,
        initialActiveTunnelIds: Set<Int> = emptySet(),
    ) : ManagedTunnelAutoConnectPort {

        val active = initialActiveTunnelIds.toMutableSet()
        val started = mutableListOf<TunnelConfig>()
        var startSucceeds = true

        override val activeTunnelIds: Set<Int>
            get() = active.toSet()

        override fun hasVpnPermission(): Boolean = hasVpnPermission

        override suspend fun startTunnel(tunnel: TunnelConfig): Boolean {
            started += tunnel
            if (startSucceeds) active += tunnel.id
            return startSucceeds
        }
    }

    private fun tunnel(id: Int, position: Int) =
        TunnelConfig(id = id, name = "tunnel-$id", position = position)

    private fun binding(deviceId: String, tunnelId: Int) =
        ManagedTunnel(
            deviceId = deviceId,
            tunnelId = tunnelId,
            deviceName = deviceId,
            interfaceId = null,
            endpoint = null,
            revision = "rev-1",
            syncedAt = 0L,
        )
}
