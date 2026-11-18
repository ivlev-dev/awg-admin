package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountDeviceRow
import space.ivlev.umbravpn.ui.screens.account.components.AccountDialogs
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@Composable
fun AccountDevicesScreen(viewModel: AccountViewModel = koinViewModel()) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    AccountDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onCreateDevice = viewModel::createDevice,
        onRenameDevice = viewModel::renameDevice,
        onDeleteDevice = viewModel::deleteDevice,
        onLogout = viewModel::logout,
        onChangeServer = viewModel::changeServer,
    )

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AccountHeader(
            title = stringResource(R.string.account_devices_title),
            subtitle =
                state.snapshot?.tariff?.let {
                    stringResource(R.string.account_devices_subtitle, it.maxDevices)
                },
        )

        when {
            state.snapshot == null && state.error == null ->
                Box(
                    modifier = Modifier.fillMaxSize().padding(top = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            state.snapshot == null && state.error != null -> {
                AccountErrorCard(state.error!!)
                AccountLoadingButton(
                    text = stringResource(R.string.account_retry),
                    onClick = viewModel::retry,
                    loading = state.isLoading,
                )
            }
            else -> {
                val snapshot = state.snapshot
                val accessBlocked = snapshot?.access?.blocked == true
                val tariffMissing =
                    snapshot == null || snapshot.tariff == null || snapshot.access.tariffMissing
                val canAddDevice = snapshot != null && !accessBlocked && !tariffMissing
                if (state.devices.isEmpty()) {
                    AccountCard {
                        Text(
                            text = stringResource(R.string.account_no_devices),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                } else {
                    state.devices.forEach { device ->
                        DeviceEntry(device, viewModel, navController)
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
