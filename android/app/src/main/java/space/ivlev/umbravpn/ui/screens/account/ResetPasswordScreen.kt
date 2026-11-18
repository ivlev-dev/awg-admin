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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import com.dokar.sonner.ToastType
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

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AccountHeader(
            title = stringResource(R.string.account_reset_title),
            subtitle = stringResource(R.string.account_reset_subtitle),
        )

        AccountFormField(
            value = state.token,
            onValueChange = viewModel::onTokenChange,
            label = stringResource(R.string.account_reset_token),
            error = state.tokenError,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )

        AccountFormField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = stringResource(R.string.account_new_password),
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

        DescriptionText(stringResource(R.string.account_password_min_length, 8))

        state.error?.let { AccountErrorCard(it) }

        AccountLoadingButton(
            text = stringResource(R.string.account_reset_action),
            onClick = viewModel::submit,
            loading = state.isSubmitting,
        )

        TextButton(
            onClick = { navController.resetTo(Route.Login) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_back_to_login))
        }
    }
}
