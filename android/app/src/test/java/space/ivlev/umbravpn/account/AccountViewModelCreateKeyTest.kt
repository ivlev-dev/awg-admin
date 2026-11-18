package space.ivlev.umbravpn.account

import java.util.UUID
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
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnectPort
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncResult
import space.ivlev.umbravpn.sync.FakeManagedTunnelRepository
import space.ivlev.umbravpn.sync.InMemoryTunnelRepository
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelCreateKeyTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val repository = FakeAccountRepository()

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
    fun showAddDeviceGeneratesUuidKey() =
        runTest(dispatcher) {
            viewModel.showAddDevice()
            settle()

            val key = state().pendingCreateKey

            assertNotNull(key)
            assertEquals(key, UUID.fromString(key).toString())
        }

    @Test
    fun retryAfterNetworkErrorReusesSameKey() =
        runTest(dispatcher) {
            viewModel.showAddDevice()
            settle()
            val firstKey = state().pendingCreateKey
            repository.createResult = AccountResult.Failure(AccountError.Network)

            viewModel.createDevice("Phone")
            settle()
            viewModel.createDevice("Phone")
            settle()

            assertEquals(listOf(firstKey, firstKey), repository.createdIdempotencyKeys)
            assertEquals(firstKey, state().pendingCreateKey)
        }

    @Test
    fun retryAfterServerErrorReusesSameKey() =
        runTest(dispatcher) {
            viewModel.showAddDevice()
            settle()
            val firstKey = state().pendingCreateKey
            repository.createResult =
                AccountResult.Failure(AccountError.Api(500, "internal", "server error"))

            viewModel.createDevice("Phone")
            settle()
            viewModel.createDevice("Phone")
            settle()

            assertEquals(listOf(firstKey, firstKey), repository.createdIdempotencyKeys)
        }

    @Test
    fun successClearsKeyAndNextDialogUsesNewOne() =
        runTest(dispatcher) {
            viewModel.showAddDevice()
            settle()
            val firstKey = state().pendingCreateKey

            viewModel.createDevice("Phone")
            settle()

            assertNull(state().pendingCreateKey)
            assertEquals(listOf(firstKey), repository.createdIdempotencyKeys)

            viewModel.showAddDevice()
            settle()
            val secondKey = state().pendingCreateKey

            assertNotNull(secondKey)
            assertNotEquals(firstKey, secondKey)
        }

    @Test
    fun dismissClearsKeyAndNextDialogUsesNewOne() =
        runTest(dispatcher) {
            viewModel.showAddDevice()
            settle()
            val firstKey = state().pendingCreateKey

            viewModel.dismissDialog()
            settle()

            assertNull(state().pendingCreateKey)

            viewModel.showAddDevice()
            settle()
            val secondKey = state().pendingCreateKey

            assertNotNull(secondKey)
            assertNotEquals(firstKey, secondKey)
        }

    @Test
    fun renameDeviceDoesNotGenerateCreateKey() =
        runTest(dispatcher) {
            repository.renameResult = AccountResult.Success(testDevice(name = "Renamed"))

            viewModel.showRenameDevice("device-1", "Pixel")
            settle()
            viewModel.renameDevice("device-1", "Renamed")
            settle()

            assertNull(state().pendingCreateKey)
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun state() = viewModel.container.stateFlow.value

    private fun buildViewModel(): AccountViewModel {
        val syncService =
            object : ManagedTunnelSyncService {
                override suspend fun sync(): SyncResult = SyncResult.Success()
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
