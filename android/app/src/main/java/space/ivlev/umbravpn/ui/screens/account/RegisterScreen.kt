package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountBackToLoginButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountPasswordField
import space.ivlev.umbravpn.viewmodel.EmailVerificationViewModel
import space.ivlev.umbravpn.viewmodel.RegisterSideEffect
import space.ivlev.umbravpn.viewmodel.RegisterViewModel

@Composable
fun RegisterScreen(
    viewModel: RegisterViewModel = koinViewModel(),
    verificationViewModel: EmailVerificationViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val state by viewModel.collectAsState()

    LaunchedEffect(Unit) { verificationViewModel.setEmail(null) }

    viewModel.collectSideEffect { effect ->
        when (effect) {
            is RegisterSideEffect.Registered -> {
                keyboardController?.hide()
                verificationViewModel.setEmail(effect.email)
                navController.resetTo(Route.Login, Route.VerifyPending(effect.email))
            }
        }
    }

    AccountFormScaffold(
        title = stringResource(R.string.account_register_title),
        subtitle = stringResource(R.string.account_register_subtitle),
    ) {
        AccountFormField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = stringResource(R.string.account_email),
            error = state.emailError,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            keyboardActions =
                KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            contentType = ContentType.EmailAddress,
        )

        AccountFormField(
            value = state.fullName,
            onValueChange = viewModel::onFullNameChange,
            label = stringResource(R.string.account_full_name_optional),
            error = state.fullNameError,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next),
            keyboardActions =
                KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            contentType = ContentType.PersonFullName,
        )

        AccountPasswordField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = stringResource(R.string.password),
            error = state.passwordError,
            visible = state.passwordVisible,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next,
                ),
            keyboardActions =
                KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            contentType = ContentType.NewPassword,
            onToggleVisibility = viewModel::togglePasswordVisibility,
        )

        AccountPasswordField(
            value = state.confirmation,
            onValueChange = viewModel::onConfirmationChange,
            label = stringResource(R.string.account_password_confirm),
            error = state.confirmationError,
            visible = state.passwordVisible,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
            keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
            contentType = ContentType.NewPassword,
            showToggle = false,
        )

        DescriptionText(
            stringResource(R.string.account_password_min_length, 8),
        )

        state.error?.let { AccountErrorCard(it) }

        AccountLoadingButton(
            text = stringResource(R.string.account_register),
            onClick = viewModel::submit,
            loading = state.isSubmitting,
        )

        Text(
            text = stringResource(R.string.account_register_terms_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        AccountBackToLoginButton(onClick = { navController.pop() })
    }
}
