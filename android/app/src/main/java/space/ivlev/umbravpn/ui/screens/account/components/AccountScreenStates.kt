package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.state.AccountUiState

@Composable
internal fun AccountLoadingContent() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
internal fun AccountSignedOutContent(state: AccountUiState) {
    val navController = LocalNavController.current
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(64.dp),
        ) {
            Icon(
                Icons.Outlined.Person,
                contentDescription = null,
                modifier = Modifier.padding(18.dp),
            )
        }
        Text(
            text = stringResource(R.string.account_sign_in_prompt_title),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Text(
            text =
                stringResource(
                    when (state.session) {
                        SessionState.PendingApproval -> R.string.account_sign_in_prompt_pending
                        SessionState.PendingEmail -> R.string.account_sign_in_prompt_email
                        else -> R.string.account_sign_in_prompt_body
                    },
                ),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center,
        )
        if (state.error != null && state.error != AccountMessage.Network) {
            AccountErrorCard(state.error)
        }
        AccountLoadingButton(
            text = stringResource(R.string.account_sign_in),
            onClick = { navController.push(Route.Login) },
        )
        AccountSecondaryButton(
            text = stringResource(R.string.account_register),
            onClick = { navController.push(Route.Register) },
        )
        TextButton(onClick = { navController.push(Route.Onboarding) }) {
            Text(stringResource(R.string.account_change_server))
        }
        if (state.serverUrl.isNotBlank()) {
            Text(
                text = state.serverUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
internal fun AccountErrorContent(
    state: AccountUiState,
    onRetry: () -> Unit,
    onConfigureServer: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AccountHeader(
            title = stringResource(R.string.account_title),
            subtitle = state.serverUrl.ifBlank { null },
        )
        state.error?.let { AccountErrorCard(it) }
        AccountLoadingButton(
            text = stringResource(R.string.account_retry),
            onClick = onRetry,
            loading = state.isLoading,
        )
        AccountSecondaryButton(
            text = stringResource(R.string.account_change_server),
            onClick = onConfigureServer,
        )
        TextButton(
            onClick = onSignOut,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(
                text = stringResource(R.string.account_logout),
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}
