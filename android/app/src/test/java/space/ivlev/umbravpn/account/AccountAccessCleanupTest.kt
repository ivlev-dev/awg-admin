package space.ivlev.umbravpn.account

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountAccessCleanup
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup

class AccountAccessCleanupTest {
    private val cleanup = FakeManagedTunnelCleanup()
    private val settings = FakeAccountSettingsRepository()
    private var autoConnectResets = 0
    private val subject =
        AccountAccessCleanup(
            tunnelCleanup = cleanup,
            resetAutoConnect = { autoConnectResets++ },
            settingsRepository = settings,
        )

    @Test
    fun blockedSessionClearsTunnelsAndAutoConnect() = runTest {
        settings.setManagedProvisioned(true)

        subject.onSessionState(SessionState.Blocked(BlockReason.Disabled, "alice@example.com"))

        assertEquals(1, cleanup.clearCalls)
        assertEquals(1, autoConnectResets)
        assertFalse(settings.managedProvisioned())
    }

    @Test
    fun repeatedBlockedStateIsCleanedOnlyOnce() = runTest {
        val blocked = SessionState.Blocked(BlockReason.Rejected, "alice@example.com")

        subject.onSessionState(blocked)
        subject.onSessionState(blocked)

        assertEquals(1, cleanup.clearCalls)
        assertEquals(1, autoConnectResets)
    }

    @Test
    fun expiredSessionIsCleanedAndBlockedAgainAfterActive() = runTest {
        subject.onSessionState(SessionState.Expired)
        subject.onSessionState(SessionState.Expired)
        assertEquals(1, cleanup.clearCalls)

        subject.onSessionState(SessionState.Active(testUser()))
        subject.onSessionState(SessionState.Blocked(BlockReason.Disabled))
        assertEquals(2, cleanup.clearCalls)
    }

    @Test
    fun activeAndLoggedOutSessionsDoNotTouchTunnels() = runTest {
        settings.setManagedProvisioned(true)

        subject.onSessionState(SessionState.Active(testUser()))
        subject.onSessionState(SessionState.LoggedOut)
        subject.onSessionState(SessionState.PendingApproval)

        assertEquals(0, cleanup.clearCalls)
        assertEquals(0, autoConnectResets)
        assertTrue(settings.managedProvisioned())
    }
}

private class FakeManagedTunnelCleanup : ManagedTunnelCleanup {
    var clearCalls = 0
        private set

    override suspend fun clear() {
        clearCalls++
    }
}
