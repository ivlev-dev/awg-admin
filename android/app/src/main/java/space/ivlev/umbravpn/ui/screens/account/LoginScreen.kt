package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountPasswordField
import space.ivlev.umbravpn.viewmodel.LoginSideEffect
import space.ivlev.umbravpn.viewmodel.LoginViewModel

@Composable
fun LoginScreen(viewModel: LoginViewModel = koinViewModel()) {
    val navController = LocalNavController.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val state by viewModel.collectAsState()

    viewModel.collectSideEffect { effect ->
        when (effect) {
            LoginSideEffect.Authenticated -> {
                keyboardController?.hide()
                navController.resetTo(Route.Tunnels, Route.Account)
            }
        }
    }

    AccountFormScaffold(
        title = stringResource(R.string.account_login_title),
        subtitle = stringResource(R.string.account_login_subtitle),
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

        AccountPasswordField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = stringResource(R.string.password),
            error = state.passwordError,
            visible = state.passwordVisible,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = if (state.showTotp) ImeAction.Next else ImeAction.Done,
                ),
            keyboardActions =
                if (state.showTotp) {
                    KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) })
                } else {
                    KeyboardActions(onDone = { viewModel.submit() })
                },
            contentType = ContentType.Password,
            onToggleVisibility = viewModel::togglePasswordVisibility,
        )

        if (state.showTotp) {
            AccountFormField(
                value = state.totpCode,
                onValueChange = viewModel::onTotpChange,
                label = stringResource(R.string.account_totp_code),
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.NumberPassword,
                        imeAction = ImeAction.Done,
                    ),
                keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
                contentType = ContentType.SmsOtpCode,
            )
        }

        TextButton(onClick = viewModel::toggleTotp) {
            Text(stringResource(R.string.account_have_totp))
        }

        state.pendingNotice?.let { notice ->
            LoginPendingNotice(
                notice = notice,
                email = state.email,
                onOpen = {
                    keyboardController?.hide()
                    navController.push(Route.VerifyPending(state.email.trim().ifBlank { null }))
                },
            )
        }

        state.error?.let { AccountErrorCard(it) }

        AccountLoadingButton(
            text = stringResource(R.string.account_sign_in),
            onClick = viewModel::submit,
            loading = state.isSubmitting,
        )

        Row(
            modifier = Modifier.align(Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.account_no_account),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
            )
            TextButton(onClick = { navController.push(Route.Register) }) {
                Text(stringResource(R.string.account_register))
            }
        }

        TextButton(
            onClick = { navController.push(Route.ForgotPassword) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_forgot_password))
        }
    }
}

@Composable
private fun LoginPendingNotice(
    notice: AccountMessage,
    email: String,
    onOpen: () -> Unit,
) {
    val emailVerified = notice == AccountMessage.EmailNotVerified
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text =
                    stringResource(
                        if (emailVerified) R.string.account_login_pending_email_title
                        else R.string.account_login_pending_approval_title,
                    ),
                style = MaterialTheme.typography.titleSmall,
            )
            Text(
                text =
                    stringResource(
                        if (emailVerified) R.string.account_login_pending_email_body
                        else R.string.account_login_pending_approval_body,
                        email.trim().ifBlank { stringResource(R.string.account_unknown) },
                    ),
                style = MaterialTheme.typography.bodyMedium,
            )
            TextButton(onClick = onOpen, modifier = Modifier.align(Alignment.End)) {
                Text(stringResource(R.string.account_login_pending_open))
            }
        }
    }
}
