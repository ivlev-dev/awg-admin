package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.account.AccountValidation
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.ui.state.ForgotPasswordUiState

class ForgotPasswordViewModel(private val authActions: AuthActions) :
    OrbitContainerHost<ForgotPasswordUiState, ForgotPasswordUiState, Nothing>, ViewModel() {

    override val container = orbitContainer<ForgotPasswordUiState, Nothing>(ForgotPasswordUiState())

    fun onEmailChange(value: String) = intent {
        reduce { state.copy(email = value, emailError = null, error = null, isSent = false) }
    }

    fun submit() = intent {
        if (state.isSubmitting) return@intent

        val emailError = AccountValidation.emailError(state.email)
        if (emailError != null) {
            reduce { state.copy(emailError = emailError, error = null) }
            return@intent
        }

        reduce { state.copy(isSubmitting = true, error = null) }
        when (val outcome = authActions.forgotPassword(state.email)) {
            is ActionResult.Success -> reduce { state.copy(isSubmitting = false, isSent = true) }
            is ActionResult.Failure ->
                reduce { state.copy(isSubmitting = false, error = outcome.message) }
        }
    }
}
