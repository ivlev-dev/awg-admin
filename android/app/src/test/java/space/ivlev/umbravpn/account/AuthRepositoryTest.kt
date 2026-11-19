package space.ivlev.umbravpn.account

import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

class AuthRepositoryTest {
    @Test
    fun loginSuccessPersistsTokensAndUser() = runTest {
        val env =
            createEnvironment(nowEpochSeconds = 1_700_000_000L) {
                jsonResponse(HttpStatusCode.OK, authJson())
            }

        val user = env.authRepository.login("alice@example.com", "secret").requireSuccess()

        assertEquals("user-1", user.id)
        assertEquals("Alice Ivanova", user.fullName)
        assertEquals("alice@example.com", user.email)
        assertEquals(UserStatus.Active, user.status)
        assertEquals(UserRole.User, user.role)
        assertTrue(user.totpEnabled)
        assertEquals("node-1", user.nodeId)
        assertEquals("tariff-1", user.tariffId)
        assertEquals("2026-01-01T10:00:00Z", user.createdAt.toString())

        val stored = env.tokenStore.session
        assertNotNull(stored)
        assertEquals("access-1", stored?.accessToken)
        assertEquals("refresh-1", stored?.refreshToken)
        assertEquals(1_700_003_600L, stored?.expiresAtEpochSeconds)
        assertEquals("user-1", stored?.userId)
        assertEquals("alice@example.com", stored?.email)
        assertEquals(SessionState.Active(user), env.sessionManager.state.value)

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/auth/login", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body.contains("\"email\":\"alice@example.com\""))
        assertTrue(body.contains("\"password\":\"secret\""))
        assertTrue(!body.contains("\"login\""))
    }

    @Test
    fun loginSendsTotpCodeWhenProvided() = runTest {
        val env = createEnvironment { jsonResponse(HttpStatusCode.OK, authJson()) }

        env.authRepository.login("alice@example.com", "secret", "123456").requireSuccess()

        val body = env.requests.single().body.toByteArray().decodeToString()
        assertTrue(body.contains("\"totp_code\":\"123456\""))
    }

    @Test
    fun loginDisabledMarksSessionBlockedAndClearsTokens() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.Forbidden,
                    errorBody("account_disabled", "account disabled"),
                )
            }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(AccountError.Disabled(BlockReason.Disabled), error)
        assertNull(env.tokenStore.session)
        assertEquals(
            SessionState.Blocked(BlockReason.Disabled, "alice@example.com"),
            env.sessionManager.state.value,
        )
    }

    @Test
    fun loginRejectedMarksSessionBlockedWithRejectedReason() = runTest {
        val env = createEnvironment {
            jsonResponse(HttpStatusCode.Forbidden, errorBody("rejected", "rejected"))
        }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(AccountError.Disabled(BlockReason.Rejected), error)
        assertEquals(
            SessionState.Blocked(BlockReason.Rejected, "alice@example.com"),
            env.sessionManager.state.value,
        )
    }

    @Test
    fun bootstrapAccountDisabledMarksSessionBlocked() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.Forbidden,
                    errorBody("account_disabled", "account disabled"),
                )
            }

        val error = env.accountRepository.bootstrap().requireFailure()

        assertEquals(AccountError.Disabled(BlockReason.Disabled), error)
        assertNull(env.tokenStore.session)
        assertTrue(env.sessionManager.state.value is SessionState.Blocked)
    }

    @Test
    fun loginPendingApprovalMarksPendingSession() = runTest {
        val env = createEnvironment {
            jsonResponse(
                HttpStatusCode.Forbidden,
                errorBody("pending_approval", "wait for approval"),
            )
        }

        env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(SessionState.PendingApproval, env.sessionManager.state.value)
    }

    @Test
    fun loginUnauthorizedReturnsTypedError() = runTest {
        val env = createEnvironment {
            jsonResponse(
                HttpStatusCode.Unauthorized,
                errorBody("unauthorized", "invalid credentials"),
            )
        }

        val error = env.authRepository.login("alice@example.com", "wrong").requireFailure()

        assertEquals(AccountError.Unauthorized, error)
        assertNull(env.tokenStore.session)
        assertEquals(SessionState.LoggedOut, env.sessionManager.state.value)
    }

    @Test
    fun loginTotpRequiredKeepsApiCode() = runTest {
        val env = createEnvironment {
            jsonResponse(
                HttpStatusCode.Unauthorized,
                errorBody("totp_required", "two-factor authentication code required"),
            )
        }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(
            AccountError.Api(401, "totp_required", "two-factor authentication code required"),
            error,
        )
    }

    @Test
    fun loginRateLimitedReturnsApiError() = runTest {
        val env = createEnvironment {
            jsonResponse(
                HttpStatusCode.TooManyRequests,
                errorBody("too_many_requests", "too many login attempts, try again later"),
            )
        }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(
            AccountError.Api(
                429,
                "too_many_requests",
                "too many login attempts, try again later",
            ),
            error,
        )
    }

    @Test
    fun loginPendingApprovalMovesSessionToPendingApproval() = runTest {
        val env = createEnvironment {
            jsonResponse(
                HttpStatusCode.Forbidden,
                errorBody("pending_approval", "account is awaiting administrator approval"),
            )
        }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(
            AccountError.Api(403, "pending_approval", "account is awaiting administrator approval"),
            error,
        )
        assertEquals(SessionState.PendingApproval, env.sessionManager.state.value)
    }

    @Test
    fun registerMovesSessionToPendingEmail() = runTest {
        val env = createEnvironment {
            jsonResponse(HttpStatusCode.Accepted, """{"status":"pending_email"}""")
        }

        env.authRepository.register("alice@example.com", "secret").requireSuccess()

        assertEquals(SessionState.PendingEmail, env.sessionManager.state.value)
        val request = env.requests.single()
        assertEquals("/api/v1/auth/register", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body.contains("\"email\":\"alice@example.com\""))
        assertTrue(body.contains("\"password\":\"secret\""))
        assertTrue(!body.contains("\"full_name\""))
    }

    @Test
    fun registerSendsFullNameWhenProvided() = runTest {
        val env = createEnvironment {
            jsonResponse(HttpStatusCode.Accepted, """{"status":"pending_email"}""")
        }

        env.authRepository
            .register("alice@example.com", "secret", "  Alice Ivanova  ")
            .requireSuccess()

        val body = env.requests.single().body.toByteArray().decodeToString()
        assertTrue(body.contains("\"full_name\":\"Alice Ivanova\""))
    }

    @Test
    fun updateFullNameSendsPatchAndUpdatesSession() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    """
                    {
                      "id": "user-1",
                      "email": "alice@example.com",
                      "full_name": "Alice Ivanova",
                      "status": "active",
                      "totp_enabled": false,
                      "role": "user",
                      "disabled": false
                    }
                    """
                        .trimIndent(),
                )
            }

        val user = env.accountRepository.updateFullName("Alice Ivanova").requireSuccess()

        assertEquals("Alice Ivanova", user.fullName)
        assertEquals(SessionState.Active(user), env.sessionManager.state.value)
        val request = env.requests.single()
        assertEquals(HttpMethod.Patch, request.method)
        assertEquals("/api/v1/auth/me", request.url.encodedPath)
        assertEquals("Bearer access-1", request.headers[HttpHeaders.Authorization])
        assertTrue(
            request.body
                .toByteArray()
                .decodeToString()
                .contains(
                    "\"full_name\":\"Alice Ivanova\"",
                ),
        )
    }

    @Test
    fun updateFullNameFailureMapsApiError() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.BadRequest,
                    errorBody("bad_request", "full_name must be 1..200 characters"),
                )
            }

        val error = env.accountRepository.updateFullName("Alice").requireFailure()

        assertEquals(
            AccountError.Api(400, "bad_request", "full_name must be 1..200 characters"),
            error,
        )
    }

    @Test
    fun verifyEmailMovesSessionToPendingApproval() = runTest {
        val env = createEnvironment {
            jsonResponse(HttpStatusCode.OK, """{"status":"pending_approval"}""")
        }

        env.authRepository.verifyEmail("token-1").requireSuccess()

        assertEquals(SessionState.PendingApproval, env.sessionManager.state.value)
        assertEquals("/api/v1/auth/verify-email", env.requests.single().url.encodedPath)
    }

    @Test
    fun logoutClearsTokens() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, """{"ok":true}""")
            }

        env.authRepository.logout().requireSuccess()

        assertNull(env.tokenStore.session)
        assertEquals(SessionState.LoggedOut, env.sessionManager.state.value)
        val request = env.requests.single()
        assertEquals("/api/v1/auth/logout", request.url.encodedPath)
        assertTrue(
            request.body.toByteArray().decodeToString().contains("\"refresh_token\":\"refresh-1\""),
        )
    }

    @Test
    fun logoutClearsTokensEvenWhenServerFails() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.InternalServerError, errorBody("internal", "boom"))
            }

        val error = env.authRepository.logout().requireFailure()

        assertEquals(AccountError.Api(500, "internal", "boom"), error)
        assertNull(env.tokenStore.session)
        assertEquals(SessionState.LoggedOut, env.sessionManager.state.value)
    }

    @Test
    fun meReturnsUpdatedUser() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    """
                    {
                      "id": "user-1",
                      "full_name": "Alice Ivanova",
                      "email": "alice@example.com",
                      "status": "active",
                      "totp_enabled": false,
                      "role": "admin",
                      "tariff_id": null,
                      "group_id": null,
                      "node_id": null,
                      "disabled": false,
                      "created_at": "2026-01-01T10:00:00Z",
                      "updated_at": "2026-01-02T11:30:00Z"
                    }
                    """
                        .trimIndent(),
                )
            }

        val user = env.authRepository.me().requireSuccess()

        assertEquals(UserRole.Admin, user.role)
        assertEquals(SessionState.Active(user), env.sessionManager.state.value)
        val request = env.requests.single()
        assertEquals("Bearer access-1", request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun requestWithoutSessionFailsWithSessionExpired() = runTest {
        val env = createEnvironment { jsonResponse(HttpStatusCode.OK, """{"ok":true}""") }

        val error = env.authRepository.me().requireFailure()

        assertEquals(AccountError.SessionExpired, error)
        assertEquals(SessionState.Expired, env.sessionManager.state.value)
        assertTrue(env.requests.isEmpty())
    }

    @Test
    fun blankServerUrlReturnsServerNotConfigured() = runTest {
        val env =
            createEnvironment(rawServerUrl = "   ") { jsonResponse(HttpStatusCode.OK, authJson()) }

        val error = env.authRepository.login("alice@example.com", "secret").requireFailure()

        assertEquals(AccountError.ServerNotConfigured, error)
        assertTrue(env.requests.isEmpty())
    }
}
