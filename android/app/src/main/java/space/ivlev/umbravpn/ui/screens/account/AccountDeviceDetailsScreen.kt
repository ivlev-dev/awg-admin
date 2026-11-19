package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.dokar.sonner.ToastType
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountDialogs
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountInfoRow
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton
import space.ivlev.umbravpn.ui.screens.account.components.accountMessageRes
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.AccountViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun AccountDeviceDetailsScreen(
    id: String,
    viewModel: AccountViewModel = koinActivityViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val state by viewModel.collectAsState()
    val device = state.devices.firstOrNull { it.id == id }

    LaunchedEffect(id) { viewModel.loadDeviceEndpoint(id) }

    viewModel.collectSideEffect { effect ->
        when (effect) {
            AccountSideEffect.SignedOut -> Unit
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
        onRenameTunnel = viewModel::renameTunnel,
        onDeleteTunnel = viewModel::deleteTunnel,
        onLogout = viewModel::logout,
        onChangeServer = viewModel::changeServer,
        onUpdateFullName = viewModel::updateFullName,
    )

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (device == null) {
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(top = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            } else {
                AccountHeader(title = stringResource(R.string.account_device_details))
                AccountErrorCard(
                    state.error ?: AccountMessage.NotFound,
                )
                if (state.error == AccountMessage.Network) {
                    Text(
                        text = stringResource(R.string.account_offline_message),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
                AccountSecondaryButton(
                    text = stringResource(R.string.account_retry),
                    onClick = viewModel::retry,
                )
            }
            return@Column
        }

        AccountHeader(
            title = device.name,
            subtitle = stringResource(R.string.account_device_details),
        )

        TunnelsCard(device = device, viewModel = viewModel)

        AccountCard {
            AccountInfoRow(
                label = stringResource(R.string.account_device_interface),
                value = device.interfaceName.ifBlank { stringResource(R.string.account_unknown) },
            )
            AccountInfoRow(
                label = stringResource(R.string.account_node),
                value = device.nodeName.ifBlank { stringResource(R.string.account_unknown) },
            )
            AccountInfoRow(
                label = stringResource(R.string.account_device_endpoint),
                value = state.deviceEndpoint ?: stringResource(R.string.account_unknown),
            )
            AccountInfoRow(
                label = stringResource(R.string.addresses),
                value =
                    device.addresses.joinToString(", ").ifBlank {
                        stringResource(R.string.account_unknown)
                    },
            )
            AccountInfoRow(
                label = stringResource(R.string.account_status),
                value =
                    stringResource(
                        if (device.revoked) R.string.account_device_revoked
                        else R.string.account_device_active,
                    ),
            )
            val createdAt = AccountFormat.date(device.createdAt)
            if (createdAt != null) {
                AccountInfoRow(
                    label = stringResource(R.string.account_device_created_at),
                    value = createdAt,
                )
            }
            state.endpointError?.let { AccountErrorCard(it) }
            HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AccountSecondaryButton(
                    text = stringResource(R.string.account_rename_device),
                    onClick = { viewModel.showRenameDevice(device.id, device.name) },
                    modifier = Modifier.weight(1f),
                )
                AccountSecondaryButton(
                    text = stringResource(R.string.account_delete_device),
                    onClick = { viewModel.showDeleteDevice(device.id, device.name) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        TextButton(onClick = viewModel::refresh) {
            Text(
                text = stringResource(R.string.account_refresh),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun TunnelsCard(device: AccountDevice, viewModel: AccountViewModel) {
    val canDelete = device.peers.size > 1
    AccountCard {
        Text(
            text = stringResource(R.string.account_tunnels_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = stringResource(R.string.account_device_tunnels_count, device.peers.size),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (!canDelete && device.peers.isNotEmpty()) {
            Text(
                text = stringResource(R.string.account_error_last_tunnel),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        if (device.peers.isEmpty()) {
            Text(
                text = stringResource(R.string.account_unknown),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 8.dp),
            )
        } else {
            val unknownLabel = stringResource(R.string.account_tunnel_unknown_label)
            device.peers.forEach { peer ->
                val label = displayTunnelLabel(peer, unknownLabel)
                TunnelRow(
                    peer = peer,
                    label = label,
                    canDelete = canDelete,
                    onRename = {
                        viewModel.showRenameTunnel(
                            deviceId = device.id,
                            peerId = peer.peerId,
                            label = label,
                        )
                    },
                    onDelete = {
                        viewModel.showDeleteTunnel(
                            deviceId = device.id,
                            peerId = peer.peerId,
                            label = label,
                        )
                    },
                )
            }
        }
        AccountSecondaryButton(
            text = stringResource(R.string.account_add_tunnel),
            onClick = { viewModel.showAddTunnel(device.id) },
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
private fun TunnelRow(
    peer: DevicePeer,
    label: String,
    canDelete: Boolean,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val details =
        listOfNotNull(
                peer.interfaceName.takeIf { it.isNotBlank() },
                peer.addresses.joinToString(", ").takeIf { it.isNotBlank() },
            )
            .joinToString(" · ")
    Surface(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = label, style = MaterialTheme.typography.bodyMedium)
                if (details.isNotBlank()) {
                    Text(
                        text = details,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
            IconButton(onClick = onRename, enabled = peer.peerId.isNotBlank()) {
                Icon(
                    Icons.Outlined.Edit,
                    contentDescription = stringResource(R.string.account_rename_tunnel),
                    tint =
                        if (peer.peerId.isNotBlank()) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                        },
                )
            }
            IconButton(onClick = onDelete, enabled = canDelete && peer.peerId.isNotBlank()) {
                Icon(
                    Icons.Outlined.Delete,
                    contentDescription = stringResource(R.string.account_delete_tunnel),
                    tint =
                        if (canDelete && peer.peerId.isNotBlank()) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                        },
                )
            }
        }
    }
}

private fun displayTunnelLabel(peer: DevicePeer, fallback: String): String =
    peer.label.trim().ifEmpty { peer.interfaceName.trim() }.ifEmpty { fallback }
