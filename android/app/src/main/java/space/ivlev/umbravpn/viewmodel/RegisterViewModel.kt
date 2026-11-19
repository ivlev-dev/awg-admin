package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountValidation
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.ui.state.RegisterUiState

sealed interface RegisterSideEffect {
    data class Registered(val email: String) : RegisterSideEffect
}

class RegisterViewModel(private val authActions: AuthActions) :
    OrbitContainerHost<RegisterUiState, RegisterUiState, RegisterSideEffect>, ViewModel() {

    override val container = orbitContainer<RegisterUiState, RegisterSideEffect>(RegisterUiState())

    fun onEmailChange(value: String) = intent {
        reduce { state.copy(email = value, emailError = null, error = null) }
    }

    fun onFullNameChange(value: String) = intent {
        reduce { state.copy(fullName = value, fullNameError = null, error = null) }
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

        val validation =
            AccountValidation.register(
                state.email,
                state.password,
                state.confirmation,
                state.fullName,
            )
        if (!validation.isValid) {
            reduce {
                state.copy(
                    emailError = validation.emailError,
                    fullNameError = validation.fullNameError,
                    passwordError = validation.passwordError,
                    confirmationError = validation.confirmationError,
                    error = null,
                )
            }
            return@intent
        }

        reduce { state.copy(isSubmitting = true, error = null) }
        when (val outcome = authActions.register(state.email, state.password, state.fullName)) {
            is ActionResult.Success -> {
                val email = state.email.trim()
                reduce {
                    state.copy(
                        isSubmitting = false,
                        password = "",
                        confirmation = "",
                        fullName = "",
                    )
                }
                postSideEffect(RegisterSideEffect.Registered(email))
            }
            is ActionResult.Failure -> {
                reduce {
                    state.copy(
                        isSubmitting = false,
                        error = outcome.message,
                        emailError =
                            when (outcome.message) {
                                AccountMessage.InvalidEmail,
                                AccountMessage.EmptyEmail,
                                AccountMessage.EmailAlreadyRegistered -> outcome.message
                                else -> null
                            },
                        fullNameError =
                            when (outcome.message) {
                                AccountMessage.FullNameTooLong -> outcome.message
                                else -> null
                            },
                        passwordError =
                            when (outcome.message) {
                                AccountMessage.PasswordTooShort,
                                AccountMessage.EmptyPassword -> outcome.message
                                else -> null
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
                fullNameError = null,
                passwordError = null,
                confirmationError = null,
            )
        }
    }
}
