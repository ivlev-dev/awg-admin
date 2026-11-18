package space.ivlev.umbravpn.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnectPort
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncResult
import space.ivlev.umbravpn.sync.FakeManagedTunnelRepository
import space.ivlev.umbravpn.sync.InMemoryTunnelRepository
import space.ivlev.umbravpn.ui.state.AccountDialog
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTunnelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val repository = FakeAccountRepository()
    private var syncCalls = 0

    private val viewModel: AccountViewModel by lazy { buildViewModel() }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        Orbit.configureDefaults {
            eventLoopDispatcher = { dispatcher }
            intentLaunchingDispatcher = { dispatcher }
        }
    }

    @After
    fun tearDown() {
        Orbit.resetDefaults()
        Dispatchers.resetMain()
    }

    @Test
    fun showAddTunnelGeneratesKeyOncePerDialog() =
        runTest(dispatcher) {
            viewModel.showAddTunnel("device-1")
            settle()
            val first = state().pendingTunnelKey

            assertNotNull(first)
            assertTrue(state().dialog is AccountDialog.AddTunnel)

            viewModel.dismissDialog()
            settle()
            assertNull(state().pendingTunnelKey)

            viewModel.showAddTunnel("device-1")
            settle()
            assertNotEquals(first, state().pendingTunnelKey)
        }

    @Test
    fun addTunnelSuccessUpdatesSnapshotAndClearsDialog() =
        runTest(dispatcher) {
            loadSnapshot()
            repository.addTunnelResult =
                AccountResult.Success(
                    CreatedDevice(
                        device =
                            testDevice(
                                peers =
                                    listOf(
                                        DevicePeer(
                                            interfaceId = "iface-1",
                                            interfaceName = "awg0",
                                            peerId = "peer-1",
                                        ),
                                        DevicePeer(
                                            interfaceId = "iface-1",
                                            interfaceName = "awg0",
                                            peerId = "peer-2",
                                            label = "extra",
                                        ),
                                    ),
                            ),
                        config = config("peer-1"),
                    ),
                )

            viewModel.showAddTunnel("device-1")
            settle()
            val key = state().pendingTunnelKey
            viewModel.addTunnel("device-1", "iface-1", "extra")
            settle()

            assertEquals(
                listOf(Triple("device-1", "iface-1", "extra")),
                repository.addedTunnels,
            )
            assertEquals(listOf(key), repository.addedTunnelKeys)
            assertNull(state().dialog)
            assertNull(state().pendingTunnelKey)
            assertEquals(
                listOf("peer-1", "peer-2"),
                state().devices.single().peers.map { it.peerId },
            )
            assertEquals(1, syncCalls)
        }

    @Test
    fun addTunnelFailureKeepsDialogAndReusesKey() =
        runTest(dispatcher) {
            loadSnapshot()
            repository.addTunnelResult = AccountResult.Failure(AccountError.Network)

            viewModel.showAddTunnel("device-1")
            settle()
            val key = state().pendingTunnelKey
            viewModel.addTunnel("device-1", "iface-1", "extra")
            settle()
            viewModel.addTunnel("device-1", "iface-1", "extra")
            settle()

            assertEquals(listOf(key, key), repository.addedTunnelKeys)
            assertEquals(key, state().pendingTunnelKey)
            assertEquals(AccountMessage.Network, state().dialogError)
            assertTrue(state().dialog is AccountDialog.AddTunnel)
        }

    @Test
    fun deleteTunnelRemovesPeerFromSnapshot() =
        runTest(dispatcher) {
            loadSnapshot()
            viewModel.showDeleteTunnel("device-1", "peer-2", "extra")
            settle()
            viewModel.deleteTunnel("device-1", "peer-2")
            settle()

            assertEquals(listOf("device-1" to "peer-2"), repository.removedTunnels)
            assertEquals(listOf("peer-1"), state().devices.single().peers.map { it.peerId })
            assertNull(state().dialog)
            assertEquals(1, syncCalls)
        }

    @Test
    fun deleteLastTunnelConflictShowsMessageAndKeepsDialog() =
        runTest(dispatcher) {
            loadSnapshot()
            repository.removeTunnelResult =
                AccountResult.Failure(
                    AccountError.Api(409, "conflict", "device must keep at least one peer"),
                )

            viewModel.showDeleteTunnel("device-1", "peer-1", "primary")
            settle()
            viewModel.deleteTunnel("device-1", "peer-1")
            settle()

            assertEquals(AccountMessage.LastTunnel, state().dialogError)
            assertTrue(state().dialog is AccountDialog.DeleteTunnel)
            assertEquals(2, state().devices.single().peers.size)
        }

    private suspend fun loadSnapshot() {
        repository.bootstrapResult =
            AccountResult.Success(
                testSnapshot(
                    devices =
                        listOf(
                            testDevice(
                                peers =
                                    listOf(
                                        DevicePeer(
                                            interfaceId = "iface-1",
                                            interfaceName = "awg0",
                                            peerId = "peer-1",
                                        ),
                                        DevicePeer(
                                            interfaceId = "iface-1",
                                            interfaceName = "awg0",
                                            peerId = "peer-2",
                                            label = "extra",
                                        ),
                                    ),
                            ),
                        ),
                ),
            )
        viewModel.retry()
        settle()
    }

    private fun config(peerId: String): DeviceConfig =
        DeviceConfig(
            interfaceId = "iface-1",
            interfaceName = "awg0",
            nodeId = "node-1",
            endpoint = "vpn.example.com:51820",
            addresses = listOf("10.8.0.2/32"),
            conf = "[Interface]",
            revision = "rev",
            peerId = peerId,
        )

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun state() = viewModel.container.stateFlow.value

    private fun buildViewModel(): AccountViewModel {
        val syncService =
            object : ManagedTunnelSyncService {
                override suspend fun sync(): SyncResult {
                    syncCalls++
                    return SyncResult.Success()
                }
            }
        val cleaner =
            object : ManagedTunnelCleanup {
                override suspend fun clear() = Unit
            }
        val port =
            object : ManagedTunnelAutoConnectPort {
                override val activeTunnelIds: Set<Int> = emptySet()

                override fun hasVpnPermission(): Boolean = false

                override suspend fun startTunnel(tunnel: TunnelConfig): Boolean = false
            }
        val autoConnector =
            ManagedTunnelAutoConnector(
                session = MutableStateFlow<SessionState>(SessionState.LoggedOut),
                managedTunnelRepository = FakeManagedTunnelRepository(),
                tunnelRepository = InMemoryTunnelRepository(),
                port = port,
            )
        return AccountViewModel(
            authRepository = FakeAuthRepository(),
            settingsRepository = FakeAccountSettingsRepository(),
            accountActions = AccountActions(repository),
            authActions = AuthActions(FakeAuthRepository(), PendingSignupCache()),
            syncService = syncService,
            tunnelCleaner = cleaner,
            autoConnector = autoConnector,
        )
    }
}
