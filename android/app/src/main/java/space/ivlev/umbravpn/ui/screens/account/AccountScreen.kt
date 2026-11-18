package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dokar.sonner.ToastType
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.banner.InfoNotice
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountDeviceRow
import space.ivlev.umbravpn.ui.screens.account.components.AccountDialogs
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountInfoRow
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountStatusChip
import space.ivlev.umbravpn.ui.screens.account.components.AccountSubscriptionCard
import space.ivlev.umbravpn.ui.screens.account.components.SubscriptionInactiveCard
import space.ivlev.umbravpn.ui.screens.account.components.TariffMissingCard
import space.ivlev.umbravpn.ui.screens.account.components.TrafficLimitedBanner
import space.ivlev.umbravpn.ui.screens.account.components.accountMessageRes
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.AccountViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun AccountScreen(
    viewModel: AccountViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    viewModel.collectSideEffect { effect ->
        when (effect) {
            AccountSideEffect.SignedOut -> navController.resetTo(Route.Login)
            is AccountSideEffect.Notice ->
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(accountMessageRes(effect.message)),
                    if (effect.isError) ToastType.Error else ToastType.Success,
                )
        }
    }

    AccountDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onCreateDevice = viewModel::createDevice,
        onRenameDevice = viewModel::renameDevice,
        onDeleteDevice = viewModel::deleteDevice,
        onAddTunnel = viewModel::addTunnel,
        onDeleteTunnel = viewModel::deleteTunnel,
        onLogout = viewModel::logout,
        onChangeServer = viewModel::changeServer,
    )

    when {
        !state.isActive && state.snapshot == null && state.session !is SessionState.Unknown ->
            SignedOutContent(state)
        state.snapshot == null && state.error == null -> LoadingContent()
        state.snapshot == null && state.error != null ->
            ErrorContent(
                state = state,
                onRetry = viewModel::retry,
                onConfigureServer = { navController.push(Route.Onboarding) },
            )
        else -> ProfileContent(state = state, viewModel = viewModel)
    }
}

@Composable
private fun LoadingContent() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun SignedOutContent(state: AccountUiState) {
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
private fun ErrorContent(
    state: AccountUiState,
    onRetry: () -> Unit,
    onConfigureServer: () -> Unit,
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
        TextButton(onClick = onConfigureServer) {
            Text(stringResource(R.string.account_change_server))
        }
    }
}

@Composable
private fun ProfileContent(state: AccountUiState, viewModel: AccountViewModel) {
    val navController = LocalNavController.current
    val snapshot = state.snapshot ?: return
    val quota = snapshot.quota
    val percent = AccountFormat.quotaPercent(quota)
    val access = snapshot.access
    val tariffMissing = snapshot.tariff == null || access.tariffMissing
    val maxDevices = snapshot.tariff?.maxDevices
    val throttled = access.throttled || quota.exceeded
    val canAddDevice = !access.blocked && !tariffMissing
    val resetAt = quota.resetAt ?: quota.periodEnd

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.error == AccountMessage.Network) {
            InfoNotice(
                title = stringResource(R.string.account_offline_title),
                message = stringResource(R.string.account_offline_message),
                actionLabel = stringResource(R.string.account_retry),
                onClick = viewModel::retry,
            )
        } else if (state.error != null) {
            AccountErrorCard(state.error)
            TextButton(onClick = viewModel::retry) { Text(stringResource(R.string.account_retry)) }
        }

        ProfileCard(snapshot)

        snapshot.subscription?.let { AccountSubscriptionCard(it) }

        if (snapshot.subscription == null && access.subscriptionInactive) {
            SubscriptionInactiveCard()
        }

        if (tariffMissing) {
            TariffMissingCard()
        }

        if (throttled) {
            TrafficLimitedBanner(resetAt = resetAt)
        }

        if (!tariffMissing) {
            AccountCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = stringResource(R.string.account_quota_title),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text =
                            AccountFormat.percent(percent)
                                ?: stringResource(R.string.account_quota_unlimited),
                        style = MaterialTheme.typography.titleMedium,
                        color =
                            if (throttled) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.primary,
                    )
                }
                if (quota.quotaBytes != null) {
                    LinearProgressIndicator(
                        progress = { ((percent ?: 0.0) / 100.0).toFloat() },
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        color =
                            if (throttled) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        text = AccountFormat.quotaUsed(quota),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                } else {
                    Text(
                        text =
                            stringResource(
                                R.string.account_quota_used,
                                AccountFormat.bytes(quota.usedBytes),
                            ),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                if (throttled) {
                    Text(
                        text = stringResource(R.string.account_quota_exceeded),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                val resetLabel = AccountFormat.date(resetAt)
                if (resetLabel != null) {
                    Text(
                        text = stringResource(R.string.account_quota_resets, resetLabel),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.Devices,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = stringResource(R.string.account_devices_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(start = 8.dp),
                )
                val count =
                    if (maxDevices != null) {
                        stringResource(
                            R.string.account_device_count,
                            snapshot.devices.size,
                            maxDevices,
                        )
                    } else {
                        snapshot.devices.size.toString()
                    }
                Text(
                    text = count,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            TextButton(onClick = { navController.push(Route.AccountDevices) }) {
                Text(stringResource(R.string.account_all_devices))
            }
        }

        if (snapshot.devices.isEmpty()) {
            AccountCard {
                Text(
                    text = stringResource(R.string.account_no_devices),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        } else {
            snapshot.devices.take(PREVIEW_DEVICE_LIMIT).forEach { device ->
                AccountDeviceRow(
                    device = device,
                    onRename = { viewModel.showRenameDevice(device.id, device.name) },
                    onDelete = { viewModel.showDeleteDevice(device.id, device.name) },
                    onClick = { navController.push(Route.AccountDeviceDetails(device.id)) },
                )
            }
        }

        AccountSecondaryButton(
            text = stringResource(R.string.account_add_device),
            onClick = viewModel::showAddDevice,
            enabled = canAddDevice,
        )
        if (!canAddDevice) {
            Text(
                text =
                    stringResource(
                        if (access.blocked) R.string.account_add_device_blocked
                        else R.string.account_add_device_no_tariff,
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

        AccountSecondaryButton(
            text = stringResource(R.string.account_refresh),
            onClick = viewModel::refresh,
            loading = state.isRefreshing || state.isLoading,
        )
        AccountSecondaryButton(
            text = stringResource(R.string.account_change_server),
            onClick = viewModel::showChangeServer,
        )
        TextButton(
            onClick = viewModel::showLogout,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(
                text = stringResource(R.string.account_logout),
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun ProfileCard(snapshot: AccountSnapshot) {
    val user = snapshot.user
    val node =
        snapshot.devices.firstOrNull { it.nodeName.isNotBlank() }?.nodeName
            ?: user.nodeId
            ?: stringResource(R.string.account_unknown)

    AccountCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    Icons.Outlined.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(12.dp),
                )
            }
            Column(
                modifier = Modifier.padding(start = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = user.email.ifBlank { user.login },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (user.login.isNotBlank() && user.login != user.email) {
                    Text(
                        text = user.login,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }
        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
        AccountInfoRow(
            label = stringResource(R.string.account_role),
            value = stringResource(roleRes(user.role)),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.account_status),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
            )
            AccountStatusChip(status = user.status, disabled = user.disabled)
        }
        AccountInfoRow(
            label = stringResource(R.string.account_tariff),
            value = snapshot.tariff?.name ?: stringResource(R.string.account_unknown),
        )
        AccountInfoRow(label = stringResource(R.string.account_node), value = node)
    }
}

@Composable
private fun roleRes(role: UserRole): Int =
    when (role) {
        UserRole.Admin -> R.string.account_role_admin
        UserRole.User -> R.string.account_role_user
        UserRole.Unknown -> R.string.account_unknown
    }

private const val PREVIEW_DEVICE_LIMIT = 3
