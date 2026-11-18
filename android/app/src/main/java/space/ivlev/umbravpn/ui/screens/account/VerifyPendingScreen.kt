package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.ui.screens.account.components.accountMessageRes
import space.ivlev.umbravpn.ui.state.EmailVerificationPhase
import space.ivlev.umbravpn.viewmodel.EmailVerificationViewModel

@Composable
fun VerifyPendingScreen(
    email: String? = null,
    viewModel: EmailVerificationViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    LaunchedEffect(email) { viewModel.setEmail(email) }
    LaunchedEffect(state.isApproved) {
        if (state.isApproved) navController.resetTo(Route.Tunnels, Route.Account)
    }

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(56.dp),
        ) {
            Icon(
                Icons.Outlined.MarkEmailRead,
                contentDescription = null,
                modifier = Modifier.padding(14.dp),
            )
        }

        AccountHeader(
            title = stringResource(R.string.account_verify_title),
            subtitle = stringResource(R.string.account_verify_subtitle),
        )

        if (state.email.isNotBlank()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.account_email),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
                Text(
                    text = state.email,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        when (val phase = state.phase) {
            EmailVerificationPhase.Idle ->
                DescriptionText(stringResource(R.string.account_verify_hint))
            EmailVerificationPhase.Verifying ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.account_verify_in_progress))
                }
            EmailVerificationPhase.Success -> {
                FeedbackCard(
                    message = AccountMessage.EmailVerified,
                    isError = false,
                )
                DescriptionText(stringResource(R.string.account_verify_approval_hint))
            }
            is EmailVerificationPhase.Failure -> {
                AccountErrorCard(phase.message)
                DescriptionText(stringResource(R.string.account_verify_failed_hint))
            }
        }

        state.feedback
            ?.takeIf {
                it != AccountMessage.EmailVerified || state.phase != EmailVerificationPhase.Success
            }
            ?.let { message ->
                val success =
                    message == AccountMessage.EmailResent || message == AccountMessage.EmailVerified
                FeedbackCard(message = message, isError = !success)
            }

        AccountLoadingButton(
            text = stringResource(R.string.account_check_approval),
            onClick = viewModel::checkApproval,
            loading = state.isChecking,
        )

        AccountSecondaryButton(
            text = stringResource(R.string.account_resend_email),
            onClick = viewModel::resend,
            loading = state.isResending,
            enabled = state.email.isNotBlank(),
        )

        Text(
            text = stringResource(R.string.account_verify_check_spam),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        TextButton(
            onClick = { navController.resetTo(Route.Login) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_back_to_login))
        }
    }
}

@Composable
private fun FeedbackCard(message: AccountMessage, isError: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color =
            if (isError) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.primaryContainer,
        contentColor =
            if (isError) MaterialTheme.colorScheme.onErrorContainer
            else MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Text(
            text = stringResource(accountMessageRes(message)),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}
