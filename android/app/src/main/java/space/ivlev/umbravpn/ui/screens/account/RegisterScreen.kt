package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
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
    val state by viewModel.collectAsState()

    LaunchedEffect(Unit) { verificationViewModel.setEmail(null) }

    viewModel.collectSideEffect { effect ->
        when (effect) {
            is RegisterSideEffect.Registered -> {
                keyboardController?.hide()
                verificationViewModel.setEmail(effect.email)
                navController.resetTo(Route.Tunnels, Route.VerifyPending(effect.email))
            }
        }
    }

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AccountHeader(
            title = stringResource(R.string.account_register_title),
            subtitle = stringResource(R.string.account_register_subtitle),
        )

        AccountFormField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = stringResource(R.string.account_email),
            error = state.emailError,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        )

        AccountFormField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = stringResource(R.string.password),
            error = state.passwordError,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next,
                ),
            visualTransformation =
                if (state.passwordVisible) VisualTransformation.None
                else PasswordVisualTransformation(),
            trailing = { modifier ->
                IconButton(onClick = viewModel::togglePasswordVisibility, modifier = modifier) {
                    Icon(
                        imageVector =
                            if (state.passwordVisible) Icons.Outlined.VisibilityOff
                            else Icons.Outlined.Visibility,
                        contentDescription =
                            stringResource(
                                if (state.passwordVisible) R.string.hide_password
                                else R.string.show_password,
                            ),
                    )
                }
            },
        )

        AccountFormField(
            value = state.confirmation,
            onValueChange = viewModel::onConfirmationChange,
            label = stringResource(R.string.account_password_confirm),
            error = state.confirmationError,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
            keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
            visualTransformation =
                if (state.passwordVisible) VisualTransformation.None
                else PasswordVisualTransformation(),
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

        TextButton(
            onClick = { navController.pop() },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_back_to_login))
        }
    }
}
