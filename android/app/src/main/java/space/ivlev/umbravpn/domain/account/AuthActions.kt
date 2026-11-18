package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.repository.AuthRepository

sealed interface ActionResult<out T> {
    data class Success<T>(val value: T) : ActionResult<T>

    data class Failure(val message: AccountMessage) : ActionResult<Nothing>
}

sealed interface ApprovalResult {
    data object Active : ApprovalResult

    data object StillPending : ApprovalResult

    data class Failure(val message: AccountMessage) : ApprovalResult
}

class AuthActions(
    private val authRepository: AuthRepository,
    private val pendingSignupCache: PendingSignupCache,
    private val onAccessBlocked: (BlockReason, String?) -> Unit = { _, _ -> },
    private val isSessionActive: () -> Boolean = { false },
) {
    suspend fun login(
        email: String,
        password: String,
        totpCode: String? = null,
    ): ActionResult<AuthUser> {
        val validation = AccountValidation.login(email, password)
        if (validation.emailError != null) return ActionResult.Failure(validation.emailError)
        if (validation.passwordError != null) return ActionResult.Failure(validation.passwordError)

        return when (
            val result =
                authRepository.login(
                    login = email.trim(),
                    password = password,
                    totpCode = totpCode?.trim()?.takeIf { it.isNotEmpty() },
                )
        ) {
            is AccountResult.Success -> {
                if (result.value.status == UserStatus.Active) pendingSignupCache.clear()
                ActionResult.Success(result.value)
            }
            is AccountResult.Failure -> {
                val blockReason = result.error.blockReason()
                if (blockReason != null) onAccessBlocked(blockReason, email.trim())
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.Login),
                )
            }
        }
    }

    suspend fun register(email: String, password: String): ActionResult<Unit> {
        val validation = AccountValidation.register(email, password, password)
        if (validation.emailError != null) return ActionResult.Failure(validation.emailError)
        if (validation.passwordError != null) return ActionResult.Failure(validation.passwordError)

        val trimmed = email.trim()
        return when (val result = authRepository.register(trimmed, password)) {
            is AccountResult.Success -> {
                pendingSignupCache.remember(trimmed, password)
                ActionResult.Success(Unit)
            }
            is AccountResult.Failure ->
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.Register),
                )
        }
    }

    suspend fun resendVerification(email: String): ActionResult<Unit> {
        val error = AccountValidation.emailError(email)
        if (error != null) return ActionResult.Failure(error)

        return when (val result = authRepository.resendVerification(email.trim())) {
            is AccountResult.Success -> ActionResult.Success(Unit)
            is AccountResult.Failure ->
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.Verification),
                )
        }
    }

    suspend fun forgotPassword(email: String): ActionResult<Unit> {
        val error = AccountValidation.emailError(email)
        if (error != null) return ActionResult.Failure(error)

        return when (val result = authRepository.forgotPassword(email.trim())) {
            is AccountResult.Success -> ActionResult.Success(Unit)
            is AccountResult.Failure ->
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.ResetPassword),
                )
        }
    }

    suspend fun resetPassword(
        token: String,
        password: String,
        confirmation: String,
    ): ActionResult<Unit> {
        val validation = AccountValidation.reset(token, password, confirmation)
        if (validation.tokenError != null) return ActionResult.Failure(validation.tokenError)
        if (validation.passwordError != null) return ActionResult.Failure(validation.passwordError)
        if (validation.confirmationError != null) {
            return ActionResult.Failure(validation.confirmationError)
        }

        return when (val result = authRepository.resetPassword(token.trim(), password)) {
            is AccountResult.Success -> ActionResult.Success(Unit)
            is AccountResult.Failure ->
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.ResetPassword),
                )
        }
    }

    suspend fun verifyEmail(token: String): ActionResult<Unit> {
        if (token.trim().isEmpty()) return ActionResult.Failure(AccountMessage.EmptyToken)
        // A signed-in account is already active. Verifying from a stale link must not clear tokens
        // or move the session back to the pending states.
        if (isSessionActive()) return ActionResult.Success(Unit)

        return when (val result = authRepository.verifyEmail(token.trim())) {
            is AccountResult.Success -> ActionResult.Success(Unit)
            is AccountResult.Failure ->
                ActionResult.Failure(
                    AccountMessages.of(result.error, AccountActionKind.Verification),
                )
        }
    }

    suspend fun checkApproval(email: String?): ApprovalResult {
        val signup = pendingSignupCache.find(email)
        if (signup != null) {
            val login = login(signup.email, signup.password)
            return when (login) {
                is ActionResult.Success ->
                    if (login.value.status == UserStatus.Active) {
                        pendingSignupCache.clear()
                        ApprovalResult.Active
                    } else {
                        ApprovalResult.StillPending
                    }
                is ActionResult.Failure ->
                    when (login.message) {
                        AccountMessage.InvalidCredentials,
                        AccountMessage.EmailNotVerified,
                        AccountMessage.PendingApproval,
                        AccountMessage.Rejected -> ApprovalResult.StillPending
                        else -> ApprovalResult.Failure(login.message)
                    }
            }
        }

        return when (val result = authRepository.me()) {
            is AccountResult.Success ->
                if (result.value.status == UserStatus.Active) ApprovalResult.Active
                else ApprovalResult.StillPending
            is AccountResult.Failure ->
                when (val message = AccountMessages.of(result.error, AccountActionKind.Generic)) {
                    AccountMessage.InvalidCredentials,
                    AccountMessage.SessionExpired,
                    AccountMessage.EmailNotVerified,
                    AccountMessage.PendingApproval,
                    AccountMessage.Rejected -> ApprovalResult.StillPending
                    else -> ApprovalResult.Failure(message)
                }
        }
    }

    suspend fun logout(): ActionResult<Unit> {
        pendingSignupCache.clear()
        return when (val result = authRepository.logout()) {
            is AccountResult.Success -> ActionResult.Success(Unit)
            is AccountResult.Failure ->
                ActionResult.Failure(AccountMessages.of(result.error, AccountActionKind.Generic))
        }
    }

    fun lastPendingEmail(): String? = pendingSignupCache.lastEmail()
}
