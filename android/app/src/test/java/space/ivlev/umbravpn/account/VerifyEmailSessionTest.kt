package space.ivlev.umbravpn.account

import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.StoredSession

class VerifyEmailSessionTest {
    private val session =
        StoredSession(
            accessToken = "access-1",
            refreshToken = "refresh-1",
            expiresAtEpochSeconds = 1_800_000_000L,
            userId = "user-1",
            email = "alice@example.com",
        )

    @Test
    fun activeSessionIgnoresVerifyTokenAndKeepsTokens() = runTest {
        val env =
            createEnvironment(initialSession = session) { jsonResponse(HttpStatusCode.OK, "{}") }
        env.sessionManager.onAuthenticated(session, testUser())

        env.authRepository.verifyEmail("stale-token").requireSuccess()

        assertTrue(env.requests.isEmpty())
        assertTrue(env.sessionManager.state.value is SessionState.Active)
        assertEquals(session, env.tokenStore.session)
    }

    @Test
    fun pendingSessionStillVerifiesAndMovesToPendingApproval() = runTest {
        val env = createEnvironment { jsonResponse(HttpStatusCode.OK, "{}") }

        env.authRepository.verifyEmail("valid-token").requireSuccess()

        assertEquals(1, env.requests.size)
        assertTrue(env.requests.single().url.toString().endsWith("auth/verify-email"))
        assertTrue(env.sessionManager.state.value is SessionState.PendingApproval)
    }
}
