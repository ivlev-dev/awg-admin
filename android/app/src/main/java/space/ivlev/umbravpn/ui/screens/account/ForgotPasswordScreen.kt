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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.viewmodel.ForgotPasswordViewModel

@Composable
fun ForgotPasswordScreen(viewModel: ForgotPasswordViewModel = koinViewModel()) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AccountHeader(
            title = stringResource(R.string.account_forgot_title),
            subtitle = stringResource(R.string.account_forgot_subtitle),
        )

        if (state.isSent) {
            Text(
                text = stringResource(R.string.account_forgot_sent),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            DescriptionText(stringResource(R.string.account_forgot_sent_hint))
            AccountSecondaryButton(
                text = stringResource(R.string.account_reset_with_token),
                onClick = { navController.push(Route.ResetPassword) },
            )
        } else {
            AccountFormField(
                value = state.email,
                onValueChange = viewModel::onEmailChange,
                label = stringResource(R.string.account_email),
                error = state.emailError,
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Done,
                    ),
                keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
                contentType = ContentType.EmailAddress,
            )
            state.error?.let { AccountErrorCard(it) }
            AccountLoadingButton(
                text = stringResource(R.string.account_send_email),
                onClick = viewModel::submit,
                loading = state.isSubmitting,
            )
            AccountSecondaryButton(
                text = stringResource(R.string.account_reset_with_token),
                onClick = { navController.push(Route.ResetPassword) },
            )
        }

        TextButton(
            onClick = { navController.resetTo(Route.Login) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_back_to_login))
        }
    }
}
