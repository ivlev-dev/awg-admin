package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountValidation
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.ui.state.ResetPasswordUiState

sealed interface ResetPasswordSideEffect {
    data object ResetDone : ResetPasswordSideEffect
}

class ResetPasswordViewModel(private val authActions: AuthActions) :
    OrbitContainerHost<ResetPasswordUiState, ResetPasswordUiState, ResetPasswordSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<ResetPasswordUiState, ResetPasswordSideEffect>(ResetPasswordUiState())

    fun onTokenChange(value: String) = intent {
        reduce { state.copy(token = value, tokenError = null, error = null) }
    }

    fun onPasswordChange(value: String) = intent {
        reduce { state.copy(password = value, passwordError = null, error = null) }
    }

    fun onConfirmationChange(value: String) = intent {
        reduce { state.copy(confirmation = value, confirmationError = null, error = null) }
    }

    fun togglePasswordVisibility() = intent {
        reduce { state.copy(passwordVisible = !state.passwordVisible) }
    }

    fun submit() = intent {
        if (state.isSubmitting) return@intent

        val validation = AccountValidation.reset(state.token, state.password, state.confirmation)
        if (!validation.isValid) {
            reduce {
                state.copy(
                    tokenError = validation.tokenError,
                    passwordError = validation.passwordError,
                    confirmationError = validation.confirmationError,
                    error = null,
                )
            }
            return@intent
        }

        reduce { state.copy(isSubmitting = true, error = null) }
        when (
            val outcome = authActions.resetPassword(state.token, state.password, state.confirmation)
        ) {
            is ActionResult.Success -> {
                reduce { state.copy(isSubmitting = false, password = "", confirmation = "") }
                postSideEffect(ResetPasswordSideEffect.ResetDone)
            }
            is ActionResult.Failure -> {
                reduce {
                    state.copy(
                        isSubmitting = false,
                        error = outcome.message,
                        passwordError =
                            when (outcome.message) {
                                AccountMessage.PasswordTooShort,
                                AccountMessage.EmptyPassword -> outcome.message
                                else -> null
                            },
                        tokenError =
                            if (outcome.message == AccountMessage.InvalidToken) {
                                outcome.message
                            } else {
                                null
                            },
                    )
                }
            }
        }
    }
}
