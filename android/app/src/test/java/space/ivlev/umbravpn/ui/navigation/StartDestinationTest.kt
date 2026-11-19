package space.ivlev.umbravpn.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

class StartDestinationTest {
    private val activeUser =
        AuthUser(
            id = "user-1",
            fullName = "User Example",
            email = "user@example.com",
            status = UserStatus.Active,
            totpEnabled = false,
            role = UserRole.User,
        )

    @Test
    fun blankServerOpensOnboardingEvenWithActiveSession() {
        assertEquals(Route.Onboarding, resolveStartRedirect("", SessionState.Active(activeUser)))
        assertEquals(Route.Onboarding, resolveStartRedirect("", SessionState.LoggedOut))
    }

    @Test
    fun configuredServerKeepsActiveSessionOnTunnels() {
        assertNull(resolveStartRedirect("https://panel.test", SessionState.Active(activeUser)))
    }

    @Test
    fun configuredServerKeepsExistingTokenOnTunnels() {
        assertNull(resolveStartRedirect("https://panel.test", SessionState.Unknown))
    }

    @Test
    fun configuredServerWithoutSessionOpensLogin() {
        assertEquals(
            Route.Login,
            resolveStartRedirect("https://panel.test", SessionState.LoggedOut),
        )
    }

    @Test
    fun expiredSessionOpensDedicatedScreen() {
        assertEquals(
            Route.SessionExpired,
            resolveStartRedirect("https://panel.test", SessionState.Expired),
        )
    }

    @Test
    fun blockedSessionOpensAccessBlockedScreen() {
        assertEquals(
            Route.AccessBlocked,
            resolveStartRedirect(
                "https://panel.test",
                SessionState.Blocked(BlockReason.Disabled),
            ),
        )
        assertEquals(
            Route.AccessBlocked,
            resolveStartRedirect(
                "https://panel.test",
                SessionState.Blocked(BlockReason.Rejected),
            ),
        )
    }

    @Test
    fun incompleteAccountStatesOpenLogin() {
        assertEquals(
            Route.Login,
            resolveStartRedirect("https://panel.test", SessionState.PendingEmail),
        )
        assertEquals(
            Route.Login,
            resolveStartRedirect("https://panel.test", SessionState.PendingApproval),
        )
    }
}
