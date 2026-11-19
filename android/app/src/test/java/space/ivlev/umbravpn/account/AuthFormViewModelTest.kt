package space.ivlev.umbravpn.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.viewmodel.ForgotPasswordViewModel
import space.ivlev.umbravpn.viewmodel.LoginSideEffect
import space.ivlev.umbravpn.viewmodel.LoginViewModel
import space.ivlev.umbravpn.viewmodel.RegisterSideEffect
import space.ivlev.umbravpn.viewmodel.RegisterViewModel
import space.ivlev.umbravpn.viewmodel.ResetPasswordSideEffect
import space.ivlev.umbravpn.viewmodel.ResetPasswordViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AuthFormViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val repository = FakeAuthRepository()
    private val actions = AuthActions(repository, PendingSignupCache())

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        Orbit.configureDefaults {
            eventLoopDispatcher = { dispatcher }
            intentLaunchingDispatcher = { dispatcher }
        }
    }

    @After
    fun tearDown() {
        Orbit.resetDefaults()
        Dispatchers.resetMain()
    }

    @Test
    fun loginRejectsEmptyFieldsWithoutCallingRepository() =
        runTest(dispatcher) {
            val viewModel = LoginViewModel(actions)

            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AccountMessage.EmptyEmail, state.emailError)
            assertEquals(AccountMessage.EmptyPassword, state.passwordError)
            assertTrue(repository.logins.isEmpty())
            assertFalse(state.isSubmitting)
        }

    @Test
    fun loginFieldsClearValidationErrors() =
        runTest(dispatcher) {
            val viewModel = LoginViewModel(actions)
            viewModel.submit()
            settle()

            viewModel.onEmailChange("alice@example.com")
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals("alice@example.com", state.email)
            assertNull(state.emailError)
        }

    @Test
    fun loginSuccessEmitsAuthenticatedSideEffect() =
        runTest(dispatcher) {
            val viewModel = LoginViewModel(actions)
            val effects = mutableListOf<LoginSideEffect>()
            backgroundScope.launch(dispatcher) {
                viewModel.container.sideEffectFlow.collect { effects += it }
            }

            viewModel.onEmailChange("alice@example.com")
            viewModel.onPasswordChange("secret")
            viewModel.submit()
            settle()

            assertEquals(listOf(LoginSideEffect.Authenticated), effects)
            assertEquals("", viewModel.container.stateFlow.value.password)
            assertEquals("alice@example.com", repository.logins.single().first)
        }

    @Test
    fun loginWithTotpRequiredOpensCodeField() =
        runTest(dispatcher) {
            repository.loginResult =
                AccountResult.Failure(AccountError.Api(401, "totp_required", "code required"))
            val viewModel = LoginViewModel(actions)

            viewModel.onEmailChange("alice@example.com")
            viewModel.onPasswordChange("secret")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertTrue(state.showTotp)
            assertEquals(AccountMessage.TotpRequired, state.error)
        }

    @Test
    fun loginPasswordVisibilityToggles() =
        runTest(dispatcher) {
            val viewModel = LoginViewModel(actions)

            viewModel.togglePasswordVisibility()
            settle()

            assertTrue(viewModel.container.stateFlow.value.passwordVisible)
        }

    @Test
    fun registerValidatesShortPasswordAndMismatch() =
        runTest(dispatcher) {
            val viewModel = RegisterViewModel(actions)

            viewModel.onEmailChange("alice@example.com")
            viewModel.onPasswordChange("short")
            viewModel.onConfirmationChange("other")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AccountMessage.PasswordTooShort, state.passwordError)
            assertEquals(AccountMessage.PasswordMismatch, state.confirmationError)
            assertTrue(repository.registered.isEmpty())
        }

    @Test
    fun registerSuccessEmitsEmailSideEffect() =
        runTest(dispatcher) {
            val viewModel = RegisterViewModel(actions)
            val effects = mutableListOf<RegisterSideEffect>()
            backgroundScope.launch(dispatcher) {
                viewModel.container.sideEffectFlow.collect { effects += it }
            }

            viewModel.onEmailChange(" alice@example.com ")
            viewModel.onPasswordChange("supersecret")
            viewModel.onConfirmationChange("supersecret")
            viewModel.submit()
            settle()

            assertEquals(listOf(RegisterSideEffect.Registered("alice@example.com")), effects)
            assertEquals("alice@example.com", repository.registered.single().first)
            assertEquals("", viewModel.container.stateFlow.value.password)
        }

    @Test
    fun registerDuplicateEmailMarksEmailField() =
        runTest(dispatcher) {
            repository.registerResult =
                AccountResult.Failure(AccountError.Api(409, "email_exists", "already registered"))
            val viewModel = RegisterViewModel(actions)

            viewModel.onEmailChange("alice@example.com")
            viewModel.onPasswordChange("supersecret")
            viewModel.onConfirmationChange("supersecret")
            viewModel.submit()
            settle()

            assertEquals(
                AccountMessage.EmailAlreadyRegistered,
                viewModel.container.stateFlow.value.emailError,
            )
        }

    @Test
    fun resetPasswordRequiresTokenAndMatchingConfirmation() =
        runTest(dispatcher) {
            val viewModel = ResetPasswordViewModel(actions)

            viewModel.onPasswordChange("supersecret")
            viewModel.onConfirmationChange("other")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AccountMessage.EmptyToken, state.tokenError)
            assertEquals(AccountMessage.PasswordMismatch, state.confirmationError)
            assertEquals(0, repository.resetCalls)
        }

    @Test
    fun resetPasswordSuccessEmitsResetDone() =
        runTest(dispatcher) {
            val viewModel = ResetPasswordViewModel(actions)
            val effects = mutableListOf<ResetPasswordSideEffect>()
            backgroundScope.launch(dispatcher) {
                viewModel.container.sideEffectFlow.collect { effects += it }
            }

            viewModel.onTokenChange("token-1")
            viewModel.onPasswordChange("supersecret")
            viewModel.onConfirmationChange("supersecret")
            viewModel.submit()
            settle()

            assertEquals(listOf(ResetPasswordSideEffect.ResetDone), effects)
            assertEquals(1, repository.resetCalls)
            assertEquals("", viewModel.container.stateFlow.value.password)
        }

    @Test
    fun resetPasswordInvalidTokenMarksTokenField() =
        runTest(dispatcher) {
            repository.resetResult =
                AccountResult.Failure(AccountError.Api(400, "invalid_token", "bad token"))
            val viewModel = ResetPasswordViewModel(actions)

            viewModel.onTokenChange("expired")
            viewModel.onPasswordChange("supersecret")
            viewModel.onConfirmationChange("supersecret")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AccountMessage.InvalidToken, state.tokenError)
        }

    @Test
    fun forgotPasswordRejectsInvalidEmail() =
        runTest(dispatcher) {
            val viewModel = ForgotPasswordViewModel(actions)

            viewModel.onEmailChange("not-an-email")
            viewModel.submit()
            settle()

            assertEquals(
                AccountMessage.InvalidEmail,
                viewModel.container.stateFlow.value.emailError,
            )
            assertTrue(repository.forgotEmails.isEmpty())
        }

    @Test
    fun forgotPasswordSuccessMarksEmailSent() =
        runTest(dispatcher) {
            val viewModel = ForgotPasswordViewModel(actions)

            viewModel.onEmailChange("alice@example.com")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertTrue(state.isSent)
            assertEquals(listOf("alice@example.com"), repository.forgotEmails)
        }

    @Test
    fun forgotPasswordFailureKeepsFormEditable() =
        runTest(dispatcher) {
            repository.forgotResult = AccountResult.Failure(AccountError.Network)
            val viewModel = ForgotPasswordViewModel(actions)

            viewModel.onEmailChange("alice@example.com")
            viewModel.submit()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AccountMessage.Network, state.error)
            assertFalse(state.isSent)
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }
}
