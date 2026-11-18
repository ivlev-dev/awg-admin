package space.ivlev.umbravpn.account

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup

class LogoutCoordinatorTest {
    private val cleanup = RecordingCleanup()
    private val settings = FakeAccountSettingsRepository()
    private var stopCalls = 0
    private var autoConnectResets = 0
    private val authRepository = FakeAuthRepository()
    private val subject =
        LogoutCoordinator(
            stopTunnels = { stopCalls++ },
            tunnelCleanup = cleanup,
            resetAutoConnect = { autoConnectResets++ },
            settingsRepository = settings,
            authActions = AuthActions(authRepository, PendingSignupCache()),
        )

    @Test
    fun logoutStopsTunnelsAndClearsManagedState() = runTest {
        settings.setManagedProvisioned(true)

        subject.logout()

        assertEquals(1, stopCalls)
        assertEquals(1, cleanup.clearCalls)
        assertEquals(1, autoConnectResets)
        assertFalse(settings.managedProvisioned())
        assertEquals(1, authRepository.logoutCalls)
    }

    @Test
    fun tunnelStopFailureStillClearsTokens() = runTest {
        val failing =
            LogoutCoordinator(
                stopTunnels = { throw IllegalStateException("backend down") },
                tunnelCleanup = cleanup,
                resetAutoConnect = { autoConnectResets++ },
                settingsRepository = settings,
                authActions = AuthActions(authRepository, PendingSignupCache()),
            )

        failing.logout()

        assertEquals(1, cleanup.clearCalls)
        assertEquals(1, authRepository.logoutCalls)
        assertFalse(settings.managedProvisioned())
    }

    private class RecordingCleanup : ManagedTunnelCleanup {
        var clearCalls = 0
            private set

        override suspend fun clear() {
            clearCalls++
        }
    }

    @Test
    fun sessionCleanupStopsTunnelsWhenAccessIsRevoked() = runTest {
        var stopped = 0
        val cleanupSubject =
            space.ivlev.umbravpn.domain.account.AccountAccessCleanup(
                tunnelCleanup = cleanup,
                resetAutoConnect = {},
                settingsRepository = settings,
                stopTunnels = { stopped++ },
            )

        cleanupSubject.onSessionState(
            space.ivlev.umbravpn.domain.model.account.SessionState.Blocked(
                space.ivlev.umbravpn.domain.model.account.BlockReason.Disabled,
            ),
        )

        assertEquals(1, stopped)
        assertTrue(cleanup.clearCalls >= 1)
    }
}
