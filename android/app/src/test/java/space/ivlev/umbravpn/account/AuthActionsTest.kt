package space.ivlev.umbravpn.account

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.ApprovalResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.UserStatus

class AuthActionsTest {
    private val repository = FakeAuthRepository()
    private val cache = PendingSignupCache()
    private val blockedRequests = mutableListOf<Pair<BlockReason, String?>>()
    private val actions =
        AuthActions(
            repository,
            cache,
            onAccessBlocked = { reason, email -> blockedRequests += reason to email },
        )

    @Test
    fun loginSuccessReturnsUserAndTrimsEmail() = runTest {
        repository.loginResult = AccountResult.Success(testUser())

        val outcome = actions.login(" alice@example.com ", "secret", null)

        assertTrue(outcome is ActionResult.Success)
        assertEquals("alice@example.com", repository.logins.single().first)
        assertEquals("secret", repository.logins.single().second)
        assertEquals(null, repository.logins.single().third)
    }

    @Test
    fun loginWrongPasswordMapsToInvalidCredentials() = runTest {
        repository.loginResult = AccountResult.Failure(AccountError.Unauthorized)

        val outcome = actions.login("alice@example.com", "wrong")

        assertEquals(AccountMessage.InvalidCredentials, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun loginTotpRequiredIsReported() = runTest {
        repository.loginResult =
            AccountResult.Failure(
                AccountError.Api(401, "totp_required", "two-factor authentication code required"),
            )

        val outcome = actions.login("alice@example.com", "secret")

        assertEquals(AccountMessage.TotpRequired, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun loginInvalidTotpIsReported() = runTest {
        repository.loginResult =
            AccountResult.Failure(AccountError.Api(401, "totp_invalid", "invalid code"))

        val outcome = actions.login("alice@example.com", "secret", "000000")

        assertEquals(AccountMessage.TotpInvalid, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun loginNetworkFailureIsReported() = runTest {
        repository.loginResult = AccountResult.Failure(AccountError.Network)

        val outcome = actions.login("alice@example.com", "secret")

        assertEquals(AccountMessage.Network, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun loginDisabledReportsBlockedWithEmail() = runTest {
        repository.loginResult = AccountResult.Failure(AccountError.Disabled(BlockReason.Disabled))

        val outcome = actions.login(" alice@example.com ", "secret")

        assertEquals(AccountMessage.AccountDisabled, (outcome as ActionResult.Failure).message)
        assertEquals(listOf(BlockReason.Disabled to "alice@example.com"), blockedRequests)
    }

    @Test
    fun loginRawRejectedCodeMapsToBlocked() = runTest {
        repository.loginResult =
            AccountResult.Failure(AccountError.Api(403, "rejected", "registration rejected"))

        val outcome = actions.login("alice@example.com", "secret")

        assertEquals(AccountMessage.Rejected, (outcome as ActionResult.Failure).message)
        assertEquals(listOf(BlockReason.Rejected to "alice@example.com"), blockedRequests)
    }

    @Test
    fun loginRawAccountDisabledCodeMapsToBlocked() = runTest {
        repository.loginResult =
            AccountResult.Failure(AccountError.Api(403, "account_disabled", "account disabled"))

        val outcome = actions.login("alice@example.com", "secret")

        assertEquals(AccountMessage.AccountDisabled, (outcome as ActionResult.Failure).message)
        assertEquals(listOf(BlockReason.Disabled to "alice@example.com"), blockedRequests)
    }

    @Test
    fun loginPendingApprovalDoesNotBlockAccess() = runTest {
        repository.loginResult =
            AccountResult.Failure(AccountError.Api(403, "pending_approval", "pending"))

        val outcome = actions.login("alice@example.com", "secret")

        assertEquals(AccountMessage.PendingApproval, (outcome as ActionResult.Failure).message)
        assertTrue(blockedRequests.isEmpty())
    }

    @Test
    fun loginWithEmptyFieldsDoesNotCallRepository() = runTest {
        assertEquals(
            AccountMessage.EmptyEmail,
            (actions.login("", "secret") as ActionResult.Failure).message,
        )
        assertEquals(
            AccountMessage.EmptyPassword,
            (actions.login("alice@example.com", "") as ActionResult.Failure).message,
        )
        assertTrue(repository.logins.isEmpty())
    }

    @Test
    fun registerValidatesEmailAndPasswordLength() = runTest {
        assertEquals(
            AccountMessage.InvalidEmail,
            (actions.register("alice", "12345678") as ActionResult.Failure).message,
        )
        assertEquals(
            AccountMessage.PasswordTooShort,
            (actions.register("alice@example.com", "1234") as ActionResult.Failure).message,
        )
        assertTrue(repository.registered.isEmpty())
    }

    @Test
    fun registerSuccessRemembersCredentialsForApprovalPolling() = runTest {
        val outcome = actions.register("alice@example.com", "12345678")

        assertTrue(outcome is ActionResult.Success)
        assertEquals("alice@example.com" to "12345678", repository.registered.single())
        assertEquals("alice@example.com", actions.lastPendingEmail())
    }

    @Test
    fun registerConflictMapsToExistingAccount() = runTest {
        repository.registerResult =
            AccountResult.Failure(AccountError.Api(409, "conflict", "user exists"))

        val outcome = actions.register("alice@example.com", "12345678")

        assertEquals(
            AccountMessage.EmailAlreadyRegistered,
            (outcome as ActionResult.Failure).message,
        )
    }

    @Test
    fun resendRequiresEmailAndReportsResult() = runTest {
        assertEquals(
            AccountMessage.EmptyEmail,
            (actions.resendVerification("") as ActionResult.Failure).message,
        )

        val outcome = actions.resendVerification(" alice@example.com ")

        assertTrue(outcome is ActionResult.Success)
        assertEquals("alice@example.com", repository.resentEmails.single())
    }

    @Test
    fun resendRateLimitIsReported() = runTest {
        repository.resendResult =
            AccountResult.Failure(
                AccountError.Api(429, "too_many_requests", "try later"),
            )

        val outcome = actions.resendVerification("alice@example.com")

        assertEquals(AccountMessage.TooManyAttempts, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun forgotPasswordValidatesEmail() = runTest {
        assertEquals(
            AccountMessage.InvalidEmail,
            (actions.forgotPassword("nope") as ActionResult.Failure).message,
        )
        assertTrue(actions.forgotPassword("alice@example.com") is ActionResult.Success)
        assertEquals("alice@example.com", repository.forgotEmails.single())
    }

    @Test
    fun resetPasswordRequiresMatchingConfirmation() = runTest {
        val outcome = actions.resetPassword("token", "12345678", "12345679")

        assertEquals(
            AccountMessage.PasswordMismatch,
            (outcome as ActionResult.Failure).message,
        )
        assertEquals(0, repository.resetCalls)
    }

    @Test
    fun verifyRejectsBlankToken() = runTest {
        val outcome = actions.verifyEmail("   ")

        assertEquals(AccountMessage.EmptyToken, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun approvalPollingUsesCachedPasswordAndActivatesAccount() = runTest {
        actions.register("alice@example.com", "12345678")
        repository.loginResult = AccountResult.Success(testUser(status = UserStatus.Active))

        val outcome = actions.checkApproval("alice@example.com")

        assertEquals(ApprovalResult.Active, outcome)
        assertEquals(1, repository.logins.size)
        assertEquals(null, actions.lastPendingEmail())
    }

    @Test
    fun approvalPollingKeepsPendingWhenNotApproved() = runTest {
        actions.register("alice@example.com", "12345678")
        repository.loginResult = AccountResult.Failure(AccountError.Unauthorized)

        assertEquals(ApprovalResult.StillPending, actions.checkApproval("alice@example.com"))
    }

    @Test
    fun approvalPollingFallsBackToMeWithoutCachedSignup() = runTest {
        repository.meResult = AccountResult.Failure(AccountError.Unauthorized)

        assertEquals(ApprovalResult.StillPending, actions.checkApproval(null))
        assertEquals(1, repository.meCalls)

        repository.meResult = AccountResult.Success(testUser())
        assertEquals(ApprovalResult.Active, actions.checkApproval(null))
    }

    @Test
    fun logoutClearsPendingSignup() = runTest {
        actions.register("alice@example.com", "12345678")

        assertTrue(actions.logout() is ActionResult.Success)
        assertEquals(1, repository.logoutCalls)
        assertEquals(null, actions.lastPendingEmail())
    }
}
