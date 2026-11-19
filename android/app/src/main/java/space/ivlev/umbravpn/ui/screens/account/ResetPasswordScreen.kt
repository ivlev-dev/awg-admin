package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.dokar.sonner.ToastType
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.functions.rememberClipboardHelper
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountBackToLoginButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountPasswordField
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.ResetPasswordSideEffect
import space.ivlev.umbravpn.viewmodel.ResetPasswordViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun ResetPasswordScreen(
    viewModel: ResetPasswordViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val clipboard = rememberClipboardHelper()
    val state by viewModel.collectAsState()

    viewModel.collectSideEffect { effect ->
        when (effect) {
            ResetPasswordSideEffect.ResetDone -> {
                keyboardController?.hide()
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(R.string.account_password_reset_done),
                    ToastType.Success,
                )
                navController.resetTo(Route.Login)
            }
        }
    }

    AccountFormScaffold(
        title = stringResource(R.string.account_reset_title),
        subtitle = stringResource(R.string.account_reset_subtitle),
    ) {
        AccountFormField(
            value = state.token,
            onValueChange = viewModel::onTokenChange,
            label = stringResource(R.string.account_reset_token),
            error = state.tokenError,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            keyboardActions =
                KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
            trailing = { modifier ->
                TextButton(
                    onClick = {
                        clipboard.paste { text ->
                            if (text.isNullOrBlank()) {
                                sharedViewModel.showSnackMessage(
                                    StringValue.StringResource(R.string.clipboard_empty),
                                    ToastType.Warning,
                                )
                            } else {
                                viewModel.onTokenChange(text.trim())
                            }
                        }
                    },
                    modifier = modifier,
                ) {
                    Text(stringResource(R.string.paste))
                }
            },
        )

        AccountPasswordField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = stringResource(R.string.account_new_password),
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

        DescriptionText(stringResource(R.string.account_password_min_length, 8))

        state.error?.let { AccountErrorCard(it) }

        AccountLoadingButton(
            text = stringResource(R.string.account_reset_action),
            onClick = viewModel::submit,
            loading = state.isSubmitting,
        )

        AccountBackToLoginButton(onClick = { navController.resetTo(Route.Login) })
    }
}
