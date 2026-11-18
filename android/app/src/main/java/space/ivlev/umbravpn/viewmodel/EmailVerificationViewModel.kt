package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.ApprovalResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.ResendCooldown
import space.ivlev.umbravpn.ui.state.EmailVerificationPhase
import space.ivlev.umbravpn.ui.state.EmailVerificationUiState

sealed interface EmailVerificationSideEffect {
    data object SignedOut : EmailVerificationSideEffect
}

class EmailVerificationViewModel(private val authActions: AuthActions) :
    OrbitContainerHost<
        EmailVerificationUiState,
        EmailVerificationUiState,
        EmailVerificationSideEffect,
    >,
    ViewModel() {

    private val resendCooldown = ResendCooldown()

    override val container =
        orbitContainer<EmailVerificationUiState, EmailVerificationSideEffect>(
            EmailVerificationUiState(email = authActions.lastPendingEmail().orEmpty()),
        )

    fun setEmail(email: String?) = intent {
        if (email.isNullOrBlank()) return@intent
        reduce { state.copy(email = email) }
    }

    fun verify(token: String) = intent {
        if (state.phase == EmailVerificationPhase.Verifying) return@intent
        reduce { state.copy(phase = EmailVerificationPhase.Verifying) }

        when (val outcome = authActions.verifyEmail(token)) {
            is ActionResult.Success -> reduce { state.copy(phase = EmailVerificationPhase.Success) }
            is ActionResult.Failure ->
                reduce { state.copy(phase = EmailVerificationPhase.Failure(outcome.message)) }
        }
    }

    fun resend() = intent {
        if (state.isResending || !resendCooldown.canResend()) return@intent
        reduce { state.copy(isResending = true, feedback = null) }

        when (val outcome = authActions.resendVerification(state.email)) {
            is ActionResult.Success -> {
                resendCooldown.markSent()
                reduce {
                    state.copy(
                        isResending = false,
                        feedback = AccountMessage.EmailResent,
                        resendCooldownSeconds = resendCooldown.remainingSeconds(),
                    )
                }
            }
            is ActionResult.Failure ->
                reduce { state.copy(isResending = false, feedback = outcome.message) }
        }
    }

    fun tickCooldown() = intent {
        val seconds = resendCooldown.remainingSeconds()
        if (seconds != state.resendCooldownSeconds) {
            reduce { state.copy(resendCooldownSeconds = seconds) }
        }
    }

    fun checkApproval() = intent {
        if (state.isChecking) return@intent
        reduce { state.copy(isChecking = true, feedback = null) }

        when (val outcome = authActions.checkApproval(state.email.ifBlank { null })) {
            ApprovalResult.Active ->
                reduce {
                    state.copy(
                        isChecking = false,
                        isApproved = true,
                        feedback = AccountMessage.EmailVerified,
                    )
                }
            ApprovalResult.StillPending ->
                reduce {
                    state.copy(isChecking = false, feedback = AccountMessage.ApprovalStillPending)
                }
            is ApprovalResult.Failure ->
                reduce { state.copy(isChecking = false, feedback = outcome.message) }
        }
    }

    fun clearFeedback() = intent { reduce { state.copy(feedback = null) } }

    fun signOut() = intent {
        authActions.logout()
        postSideEffect(EmailVerificationSideEffect.SignedOut)
    }
}
