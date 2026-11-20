package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lan
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.model.admin.AdminGroup
import space.ivlev.umbravpn.domain.model.admin.AdminInterface
import space.ivlev.umbravpn.domain.model.admin.AdminNode
import space.ivlev.umbravpn.domain.model.admin.AdminPool
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.ui.common.functions.rememberClipboardHelper
import space.ivlev.umbravpn.ui.state.AdminInterfaceReveal
import space.ivlev.umbravpn.ui.state.AdminTokenReveal
import space.ivlev.umbravpn.viewmodel.interfaceLabel

@Composable
fun AdminNodeCard(
    node: AdminNode,
    onRotate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = node.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onRotate) {
                    Icon(
                        Icons.Outlined.Key,
                        contentDescription = stringResource(R.string.admin_node_rotate),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.admin_action_delete),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AdminChip(
                    text =
                        stringResource(
                            if (node.online) R.string.admin_node_online
                            else R.string.admin_node_offline,
                        ),
                    emphasized = node.online,
                )
                node.workerVersion?.takeIf { it.isNotBlank() }?.let { AdminChip(text = it) }
                    ?: node.version?.takeIf { it.isNotBlank() }?.let { AdminChip(text = it) }
            }
            Text(
                text =
                    stringResource(
                        R.string.admin_node_last_seen,
                        adminDateTime(node.lastSeen) ?: stringResource(R.string.admin_node_never),
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.admin_node_interfaces_value, node.interfaces),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun AdminInterfaceCard(
    item: AdminInterface,
    onEdit: () -> Unit,
    onRotate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = interfaceLabel(item),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = stringResource(R.string.admin_action_edit),
                    )
                }
                IconButton(onClick = onRotate) {
                    Icon(
                        Icons.Outlined.Key,
                        contentDescription = stringResource(R.string.admin_interface_rotate),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.admin_action_delete),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AdminChip(text = item.name)
                AdminChip(
                    text =
                        stringResource(
                            if (item.enabled) R.string.admin_interface_enabled
                            else R.string.admin_interface_disabled,
                        ),
                    emphasized = item.enabled,
                )
            }
            Text(
                text =
                    "${item.groupName.ifBlank { item.groupId }} · ${item.nodeName.ifBlank { item.nodeId }}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text =
                    "${item.endpointHost}:${item.endpointPort} → ${item.listenPort} · MTU ${item.mtu}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.admin_interface_peers_value, item.peers),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
fun AdminGroupCard(
    group: AdminGroup,
    onPools: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = group.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onPools) {
                    Icon(
                        Icons.Outlined.Lan,
                        contentDescription = stringResource(R.string.admin_group_pools),
                    )
                }
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = stringResource(R.string.admin_action_edit),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.admin_action_delete),
                    )
                }
            }
            if (group.description.isNotBlank()) {
                Text(
                    text = group.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = group.baseCidr,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text =
                    stringResource(
                        R.string.admin_group_counts_value,
                        group.interfaces,
                        group.devices,
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
fun AdminPoolCard(
    pool: AdminPool,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = pool.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = stringResource(R.string.admin_action_edit),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.admin_action_delete),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AdminChip(text = pool.cidr)
                AdminChip(text = adminPoolModeLabel(pool.mode))
                AdminChip(
                    text =
                        stringResource(
                            if (pool.enabled) R.string.admin_interface_enabled
                            else R.string.admin_interface_disabled,
                        ),
                    emphasized = pool.enabled,
                )
            }
            pool.gateway
                ?.takeIf { it.isNotBlank() }
                ?.let {
                    Text(
                        text = stringResource(R.string.admin_pool_gateway_value, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
        }
    }
}

@Composable
fun AdminTokenDialog(reveal: AdminTokenReveal, onDismiss: () -> Unit) {
    val clipboard = rememberClipboardHelper()
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { clipboard.copy(reveal.token, sensitive = true) }) {
                Text(stringResource(R.string.copy))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.admin_close)) }
        },
        title = {
            Text(
                stringResource(
                    when (reveal.reason) {
                        space.ivlev.umbravpn.ui.state.AdminTokenReason.Created ->
                            R.string.admin_node_token_created_title
                        space.ivlev.umbravpn.ui.state.AdminTokenReason.Rotated ->
                            R.string.admin_node_token_rotated_title
                    },
                ),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.admin_node_token_warning))
                SecretValue(value = reveal.token)
            }
        },
    )
}

@Composable
fun AdminPublicKeyDialog(reveal: AdminInterfaceReveal, onDismiss: () -> Unit) {
    val clipboard = rememberClipboardHelper()
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { clipboard.copy(reveal.publicKey) }) {
                Text(stringResource(R.string.copy))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.admin_close)) }
        },
        title = { Text(stringResource(R.string.admin_interface_rotated_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.admin_interface_rotated_body, reveal.name))
                SecretValue(value = reveal.publicKey)
            }
        },
    )
}

@Composable
private fun SecretValue(value: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
fun adminPoolModeLabel(mode: AdminPoolMode): String =
    stringResource(
        when (mode) {
            AdminPoolMode.Auto -> R.string.admin_pool_mode_auto
            AdminPoolMode.RfOnly -> R.string.admin_pool_mode_rf_only
            AdminPoolMode.ExternalOnly -> R.string.admin_pool_mode_external_only
        },
    )

fun adminDateTime(instant: java.time.Instant?): String? = AccountFormat.date(instant)
