package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.textbox.CustomTextField
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountDeviceRow
import space.ivlev.umbravpn.ui.screens.account.components.AccountDialogs
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.ui.state.AccountDevicesState
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.ui.state.DeviceListFooter
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@Composable
fun AccountDevicesScreen(viewModel: AccountViewModel = koinActivityViewModel()) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()
    val devices = state.deviceList

    AccountDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onCreateDevice = viewModel::createDevice,
        onRenameDevice = viewModel::renameDevice,
        onDeleteDevice = viewModel::deleteDevice,
        onAddTunnel = viewModel::addTunnel,
        onRenameTunnel = viewModel::renameTunnel,
        onDeleteTunnel = viewModel::deleteTunnel,
        onLogout = viewModel::logout,
        onChangeServer = viewModel::changeServer,
        onUpdateFullName = viewModel::updateFullName,
    )

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "header") {
            AccountHeader(
                title = stringResource(R.string.account_devices_title),
                subtitle =
                    state.snapshot?.tariff?.let {
                        stringResource(R.string.account_devices_subtitle, it.maxDevices)
                    },
            )
        }

        val error = state.error
        when {
            state.snapshot == null && error == null ->
                item(key = "loading") {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }
            state.snapshot == null && error != null ->
                item(key = "error") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AccountErrorCard(error)
                        AccountLoadingButton(
                            text = stringResource(R.string.account_retry),
                            onClick = viewModel::retry,
                            loading = state.isLoading,
                        )
                    }
                }
            else -> {
                item(key = "controls") {
                    DeviceFilters(
                        query = devices.query,
                        status = devices.status,
                        onQueryChange = viewModel::setDevicesQuery,
                        onStatusChange = viewModel::setDevicesStatus,
                    )
                }

                item(key = "counter") { DevicesCounter(devices) }

                if (devices.isLoading && devices.items.isEmpty()) {
                    item(key = "devices-loading") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                } else if (devices.isEmpty) {
                    item(key = "empty") {
                        AccountCard {
                            Text(
                                text = stringResource(R.string.account_no_devices),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                    }
                }

                items(devices.items, key = { it.id }) { device ->
                    DeviceEntry(device, viewModel, navController)
                }

                item(key = "footer") {
                    DevicesFooter(
                        devices = devices,
                        onLoadMore = viewModel::loadMoreDevices,
                        onRetry = viewModel::refreshDevices,
                    )
                }

                item(key = "actions") { AddDeviceSection(state = state, viewModel = viewModel) }
            }
        }
    }
}

@Composable
private fun DeviceFilters(
    query: String,
    status: DeviceStatusFilter,
    onQueryChange: (String) -> Unit,
    onStatusChange: (DeviceStatusFilter) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CustomTextField(
            value = query,
            onValueChange = onQueryChange,
            containerColor = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = {
                Text(
                    text = stringResource(R.string.account_devices_search),
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = status == DeviceStatusFilter.All,
                onClick = { onStatusChange(DeviceStatusFilter.All) },
                label = { Text(stringResource(R.string.account_devices_filter_all)) },
            )
            FilterChip(
                selected = status == DeviceStatusFilter.Active,
                onClick = { onStatusChange(DeviceStatusFilter.Active) },
                label = { Text(stringResource(R.string.account_device_active)) },
            )
            FilterChip(
                selected = status == DeviceStatusFilter.Revoked,
                onClick = { onStatusChange(DeviceStatusFilter.Revoked) },
                label = { Text(stringResource(R.string.account_device_revoked)) },
            )
        }
    }
}

@Composable
private fun DevicesCounter(devices: AccountDevicesState) {
    if (!devices.isLoaded) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text =
                stringResource(
                    R.string.account_device_count,
                    devices.items.size,
                    devices.total,
                ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        if (devices.isLoading) {
            CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun DevicesFooter(
    devices: AccountDevicesState,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    when (devices.footer) {
        DeviceListFooter.None -> Unit
        DeviceListFooter.Loading ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        DeviceListFooter.Error ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AccountErrorCard(devices.error ?: AccountMessage.Unknown)
                TextButton(onClick = onRetry) { Text(stringResource(R.string.account_retry)) }
            }
        DeviceListFooter.LoadMore -> {
            LaunchedEffect(devices.items.size, devices.query, devices.status) { onLoadMore() }
            TextButton(
                onClick = onLoadMore,
                enabled = devices.canLoadMore,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.account_devices_load_more))
            }
        }
        DeviceListFooter.End ->
            Text(
                text = stringResource(R.string.account_devices_end),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            )
    }
}

@Composable
private fun AddDeviceSection(
    state: AccountUiState,
    viewModel: AccountViewModel,
) {
    val snapshot = state.snapshot
    val accessBlocked = snapshot?.access?.blocked == true
    val tariffMissing = snapshot == null || snapshot.tariff == null || snapshot.access.tariffMissing
    val canAddDevice = snapshot != null && !accessBlocked && !tariffMissing

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AccountSecondaryButton(
            text = stringResource(R.string.account_add_device),
            onClick = viewModel::showAddDevice,
            enabled = canAddDevice,
        )
        if (!canAddDevice) {
            Text(
                text =
                    stringResource(
                        if (accessBlocked) R.string.account_add_device_blocked
                        else R.string.account_add_device_no_tariff,
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
        TextButton(
            onClick = viewModel::refresh,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(stringResource(R.string.account_refresh))
        }
    }
}

@Composable
private fun DeviceEntry(
    device: AccountDevice,
    viewModel: AccountViewModel,
    navController: space.ivlev.umbravpn.ui.navigation.NavController,
) {
    AccountDeviceRow(
        device = device,
        onRename = { viewModel.showRenameDevice(device.id, device.name) },
        onDelete = { viewModel.showDeleteDevice(device.id, device.name) },
        onClick = { navController.push(Route.AccountDeviceDetails(device.id)) },
    )
}
