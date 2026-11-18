package space.ivlev.umbravpn.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.data.network.ServerProbe
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.account.ServerProbeResult
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.viewmodel.OnboardingViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {

    private val dispatcher = UnconfinedTestDispatcher()

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
    fun checkConnectionNeverChangesTheSavedServer() =
        runTest(dispatcher) {
            val settings = FakeAccountSettingsRepository()
            val calls = mutableListOf<String>()
            val viewModel = buildViewModel(settings, calls)

            viewModel.onServerUrlChange("https://other.example")
            viewModel.checkConnection()
            val state =
                viewModel.container.stateFlow.first { it.probeResult != null || it.error != null }

            assertEquals(ServerProbeResult.Ready, state.probeResult)
            assertEquals(TEST_SERVER_URL, settings.serverUrl())
            assertTrue(calls.isEmpty())
        }

    @Test
    fun savingServerSignsOutBeforeSwitching() =
        runTest(dispatcher) {
            val settings = FakeAccountSettingsRepository()
            val calls = mutableListOf<String>()
            val viewModel = buildViewModel(settings, calls)

            viewModel.onServerUrlChange("https://other.example")
            viewModel.save()
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals("https://other.example", settings.serverUrl())
            assertTrue(calls.contains("stop"))
        }

    private fun buildViewModel(
        settings: FakeAccountSettingsRepository,
        calls: MutableList<String>,
    ): OnboardingViewModel {
        val client =
            HttpClient(MockEngine) { engine { addHandler { respond("ok", HttpStatusCode.OK) } } }
        val cleaner =
            object : ManagedTunnelCleanup {
                override suspend fun clear() = Unit
            }
        val logoutCoordinator =
            LogoutCoordinator(
                stopTunnels = { calls += "stop" },
                tunnelCleanup = cleaner,
                resetAutoConnect = { calls += "reset" },
                settingsRepository = settings,
                authActions = AuthActions(FakeAuthRepository(), PendingSignupCache()),
            )

        return OnboardingViewModel(
            settingsRepository = settings,
            serverProbe = ServerProbe(client),
            logoutCoordinator = logoutCoordinator,
        )
    }
}
