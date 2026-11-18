package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.ServerProbeResult

data class OnboardingUiState(
    val serverUrl: String = "",
    val isSaving: Boolean = false,
    val isChecking: Boolean = false,
    val error: AccountMessage? = null,
    val probeResult: ServerProbeResult? = null,
)

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val totpCode: String = "",
    val showTotp: Boolean = false,
    val passwordVisible: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: AccountMessage? = null,
    val emailError: AccountMessage? = null,
    val passwordError: AccountMessage? = null,
)

data class RegisterUiState(
    val email: String = "",
    val password: String = "",
    val confirmation: String = "",
    val passwordVisible: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: AccountMessage? = null,
    val emailError: AccountMessage? = null,
    val passwordError: AccountMessage? = null,
    val confirmationError: AccountMessage? = null,
)

data class ForgotPasswordUiState(
    val email: String = "",
    val isSubmitting: Boolean = false,
    val isSent: Boolean = false,
    val error: AccountMessage? = null,
    val emailError: AccountMessage? = null,
)

data class ResetPasswordUiState(
    val token: String = "",
    val password: String = "",
    val confirmation: String = "",
    val passwordVisible: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: AccountMessage? = null,
    val tokenError: AccountMessage? = null,
    val passwordError: AccountMessage? = null,
    val confirmationError: AccountMessage? = null,
)

sealed interface EmailVerificationPhase {
    data object Idle : EmailVerificationPhase

    data object Verifying : EmailVerificationPhase

    data object Success : EmailVerificationPhase

    data class Failure(val message: AccountMessage) : EmailVerificationPhase
}

data class EmailVerificationUiState(
    val email: String = "",
    val phase: EmailVerificationPhase = EmailVerificationPhase.Idle,
    val isChecking: Boolean = false,
    val isResending: Boolean = false,
    val feedback: AccountMessage? = null,
    val isApproved: Boolean = false,
)
