package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountValidation
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.ui.state.LoginUiState

sealed interface LoginSideEffect {
    data object Authenticated : LoginSideEffect
}

class LoginViewModel(private val authActions: AuthActions) :
    OrbitContainerHost<LoginUiState, LoginUiState, LoginSideEffect>, ViewModel() {

    override val container =
        orbitContainer<LoginUiState, LoginSideEffect>(LoginUiState()) {
            intent { reduce { state.copy(email = authActions.lastPendingEmail().orEmpty()) } }
        }

    fun onEmailChange(value: String) = intent {
        reduce { state.copy(email = value, emailError = null, error = null) }
    }

    fun onPasswordChange(value: String) = intent {
        reduce { state.copy(password = value, passwordError = null, error = null) }
    }

    fun onTotpChange(value: String) = intent {
        reduce { state.copy(totpCode = value, error = null) }
    }

    fun toggleTotp() = intent {
        reduce {
            state.copy(
                showTotp = !state.showTotp,
                totpCode = if (state.showTotp) "" else state.totpCode,
            )
        }
    }

    fun togglePasswordVisibility() = intent {
        reduce { state.copy(passwordVisible = !state.passwordVisible) }
    }

    fun submit() = intent {
        if (state.isSubmitting) return@intent

        val validation = AccountValidation.login(state.email, state.password)
        if (!validation.isValid) {
            reduce {
                state.copy(
                    emailError = validation.emailError,
                    passwordError = validation.passwordError,
                    error = null,
                )
            }
            return@intent
        }

        reduce { state.copy(isSubmitting = true, error = null) }
        val outcome =
            authActions.login(
                email = state.email,
                password = state.password,
                totpCode = state.totpCode.takeIf { state.showTotp },
            )

        when (outcome) {
            is ActionResult.Success -> {
                reduce { state.copy(isSubmitting = false, password = "", totpCode = "") }
                postSideEffect(LoginSideEffect.Authenticated)
            }
            is ActionResult.Failure -> {
                val showTotp =
                    state.showTotp ||
                        outcome.message == AccountMessage.TotpRequired ||
                        outcome.message == AccountMessage.TotpInvalid
                reduce {
                    state.copy(
                        isSubmitting = false,
                        error = outcome.message,
                        showTotp = showTotp,
                        passwordError =
                            if (outcome.message == AccountMessage.EmptyPassword) {
                                outcome.message
                            } else {
                                null
                            },
                        emailError =
                            if (
                                outcome.message == AccountMessage.EmptyEmail ||
                                    outcome.message == AccountMessage.InvalidEmail
                            ) {
                                outcome.message
                            } else {
                                null
                            },
                    )
                }
            }
        }
    }

    fun clearError() = intent {
        reduce {
            state.copy(
                error = null,
                emailError = null,
                passwordError = null,
            )
        }
    }
}
