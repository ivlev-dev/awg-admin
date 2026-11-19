package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Circle
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.ui.state.DisplayTunnelState
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.theme.LocalStatusColors

internal fun tunnelRowDescription(
    tunnel: TunnelConfig,
    uiState: TunnelsUiState,
    displayState: DisplayTunnelState? = null,
): (@Composable () -> Unit)? {
    val entryName =
        tunnel.entryTunnelId?.let { id -> uiState.tunnels.firstOrNull { it.id == id }?.name }
    val latency = uiState.pingLatencies[tunnel.id]
    val managed = tunnel.id in uiState.managedTunnelIds
    val showStatus = displayState != null && displayState != DisplayTunnelState.Disconnected
    if (!managed && entryName == null && latency == null && !showStatus) return null
    return {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (showStatus) {
                val statusColors = LocalStatusColors.current
                val state = displayState
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        Icons.Rounded.Circle,
                        contentDescription = null,
                        tint = statusColors.colorFor(state.statusKind()),
                        modifier = Modifier.size(8.dp),
                    )
                    Text(
                        text = stringResource(state.labelRes()),
                        style = MaterialTheme.typography.labelSmall,
                        color = statusColors.colorFor(state.statusKind()),
                    )
                }
            }
            if (managed) {
                ManagedTunnelBadge()
            }
            if (entryName != null) {
                Text(
                    text = stringResource(R.string.via_entry, entryName),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            if (latency != null) {
                PingLatencyText(latency)
            }
        }
    }
}

@Composable
private fun ManagedTunnelBadge() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            Icons.Rounded.Cloud,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(12.dp),
        )
        Text(
            text = stringResource(R.string.tunnel_managed_badge),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun PingLatencyText(latency: Double) {
    Text(
        text = pingLatencyLabel(latency),
        style = MaterialTheme.typography.bodySmall,
        color = pingLatencyColor(latency),
    )
}
