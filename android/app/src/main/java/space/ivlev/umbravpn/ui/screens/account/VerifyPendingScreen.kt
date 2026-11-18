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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.dokar.sonner.ToastType
import kotlinx.coroutines.delay
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.ui.screens.account.components.VerificationStepper
import space.ivlev.umbravpn.ui.state.EmailVerificationPhase
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.EmailVerificationSideEffect
import space.ivlev.umbravpn.viewmodel.EmailVerificationViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun VerifyPendingScreen(
    email: String? = null,
    viewModel: EmailVerificationViewModel = koinActivityViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    LaunchedEffect(email) { viewModel.setEmail(email) }
    LaunchedEffect(state.isApproved) {
        if (state.isApproved) navController.resetTo(Route.Tunnels, Route.Account)
    }
    LaunchedEffect(state.resendCooldownSeconds) {
        if (state.resendCooldownSeconds > 0) {
            delay(1_000L)
            viewModel.tickCooldown()
        }
    }
    LaunchedEffect(state.feedback) {
        if (state.feedback == AccountMessage.EmailResent) {
            sharedViewModel.showSnackMessage(
                StringValue.StringResource(R.string.account_email_resent),
                ToastType.Success,
            )
            viewModel.clearFeedback()
        }
    }

    viewModel.collectSideEffect { effect ->
        when (effect) {
            EmailVerificationSideEffect.SignedOut -> navController.resetTo(Route.Login)
        }
    }

    val emailVerified = state.phase == EmailVerificationPhase.Success
    val currentStep = if (emailVerified) 1 else 0

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
            AccountCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.account_email),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    Text(
                        text = state.email,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }

        state.pendingDeepLinkToken?.let {
            AccountCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.verify_email_confirm_title),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    DescriptionText(stringResource(R.string.verify_email_confirm_body))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = viewModel::dismissDeepLink) {
                            Text(stringResource(R.string.verify_email_confirm_dismiss))
                        }
                        AccountLoadingButton(
                            text = stringResource(R.string.verify_email_confirm_action),
                            onClick = viewModel::confirmDeepLink,
                        )
                    }
                }
            }
        }

        VerificationStepper(currentStep = currentStep, completed = state.isApproved)

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
                Text(
                    text = stringResource(R.string.account_email_verified),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                DescriptionText(stringResource(R.string.account_verify_approval_hint))
            }
            is EmailVerificationPhase.Failure -> {
                AccountErrorCard(phase.message)
                DescriptionText(stringResource(R.string.account_verify_failed_hint))
            }
        }

        state.feedback
            ?.takeIf { it != AccountMessage.EmailResent }
            ?.let { message -> AccountErrorCard(message) }

        AccountLoadingButton(
            text = stringResource(R.string.account_check_approval),
            onClick = viewModel::checkApproval,
            loading = state.isChecking,
        )

        val cooldown = state.resendCooldownSeconds
        AccountSecondaryButton(
            text =
                if (cooldown > 0) {
                    stringResource(R.string.account_resend_email_wait, cooldown)
                } else {
                    stringResource(R.string.account_resend_email)
                },
            onClick = viewModel::resend,
            loading = state.isResending,
            enabled = state.email.isNotBlank() && cooldown == 0,
        )

        Text(
            text = stringResource(R.string.account_verify_check_spam),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        var confirmSignOut by remember { mutableStateOf(false) }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
        ) {
            TextButton(onClick = { confirmSignOut = true }) {
                Text(stringResource(R.string.account_switch_account))
            }
        }

        if (confirmSignOut) {
            AlertDialog(
                onDismissRequest = { confirmSignOut = false },
                title = { Text(stringResource(R.string.account_logout)) },
                text = { Text(stringResource(R.string.account_logout_message)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            confirmSignOut = false
                            viewModel.signOut()
                        },
                    ) {
                        Text(stringResource(R.string.account_logout))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmSignOut = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                },
            )
        }
    }
}
