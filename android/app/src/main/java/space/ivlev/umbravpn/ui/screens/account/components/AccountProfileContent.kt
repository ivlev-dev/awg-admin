package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.banner.InfoNotice
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@Composable
internal fun AccountProfileContent(state: AccountUiState, viewModel: AccountViewModel) {
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

        AccountProfileCard(snapshot, onEditFullName = viewModel::showEditFullName)

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
            AccountQuotaCard(
                quota = quota,
                percent = percent,
                throttled = throttled,
                resetAt = resetAt,
            )
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
                            state.deviceTotal,
                            maxDevices,
                        )
                    } else {
                        state.deviceTotal.toString()
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

        if (state.previewDevices.isEmpty()) {
            AccountCard {
                Text(
                    text = stringResource(R.string.account_no_devices),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        } else {
            state.previewDevices.forEach { device ->
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
