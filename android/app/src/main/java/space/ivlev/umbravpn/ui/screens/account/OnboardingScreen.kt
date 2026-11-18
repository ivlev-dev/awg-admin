package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.ServerProbeResult
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormField
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.viewmodel.OnboardingSideEffect
import space.ivlev.umbravpn.viewmodel.OnboardingViewModel

@Composable
fun OnboardingScreen(viewModel: OnboardingViewModel = koinViewModel()) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    viewModel.collectSideEffect { effect ->
        when (effect) {
            OnboardingSideEffect.OpenLogin -> navController.resetTo(Route.Login)
            OnboardingSideEffect.UseManually -> navController.resetTo(Route.Tunnels)
        }
    }

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(56.dp),
        ) {
            Icon(
                Icons.Outlined.Dns,
                contentDescription = null,
                modifier = Modifier.padding(14.dp),
            )
        }
        AccountHeader(
            title = stringResource(R.string.account_onboarding_title),
            subtitle = stringResource(R.string.account_onboarding_subtitle),
        )
        AccountFormField(
            value = state.serverUrl,
            onValueChange = viewModel::onServerUrlChange,
            label = stringResource(R.string.account_server_url),
            error = state.error,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
        )
        DescriptionText(stringResource(R.string.account_server_url_hint))

        when (state.probeResult) {
            ServerProbeResult.Ready ->
                Text(
                    text = stringResource(R.string.account_server_ready),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            ServerProbeResult.Unavailable ->
                Text(
                    text = stringResource(R.string.account_server_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            ServerProbeResult.Unreachable ->
                Text(
                    text = stringResource(R.string.account_server_unreachable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            null -> Unit
        }

        Spacer(modifier = Modifier.size(4.dp))
        AccountLoadingButton(
            text = stringResource(R.string.account_continue),
            onClick = viewModel::save,
            loading = state.isSaving,
        )
        AccountSecondaryButton(
            text = stringResource(R.string.account_check_connection),
            onClick = viewModel::checkConnection,
            loading = state.isChecking,
        )
        TextButton(
            onClick = viewModel::skip,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_setup_later))
        }
        Text(
            text = stringResource(R.string.account_onboarding_manual_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
    }
}
