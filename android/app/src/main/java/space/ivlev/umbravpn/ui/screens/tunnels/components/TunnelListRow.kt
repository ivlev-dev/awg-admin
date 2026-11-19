package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.rounded.Circle
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.wgtunnel.backend.state.ActiveTunnel
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.button.SwitchWithDivider
import space.ivlev.umbravpn.ui.state.DisplayTunnelState
import space.ivlev.umbravpn.ui.state.TunnelListRow
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.theme.LocalStatusColors
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
internal fun TunnelListRowContent(
    row: TunnelListRow,
    uiState: TunnelsUiState,
    viewModel: SharedAppViewModel,
    isTv: Boolean,
    isDragging: Boolean,
    focusRequester: FocusRequester?,
    onNavigateTunnel: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (row) {
        is TunnelListRow.GroupHeader ->
            GroupHeaderRow(
                row = row,
                uiState = uiState,
                viewModel = viewModel,
                isDragging = isDragging,
                focusRequester = focusRequester,
                modifier = modifier,
            )
        is TunnelListRow.TunnelRow ->
            TunnelItemRow(
                row = row,
                uiState = uiState,
                viewModel = viewModel,
                isTv = isTv,
                isDragging = isDragging,
                focusRequester = focusRequester,
                onNavigateTunnel = onNavigateTunnel,
                modifier = modifier,
            )
    }
}

@Composable
private fun GroupHeaderRow(
    row: TunnelListRow.GroupHeader,
    uiState: TunnelsUiState,
    viewModel: SharedAppViewModel,
    isDragging: Boolean,
    focusRequester: FocusRequester?,
    modifier: Modifier = Modifier,
) {
    SurfaceRow(
        modifier =
            modifier.then(
                if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier,
            ),
        leading = {
            Icon(
                if (row.visibleExpanded) Icons.Outlined.FolderOpen else Icons.Outlined.Folder,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
        },
        title = row.group.name,
        description =
            // Count of tunnels in the group, not a suffix on the name
            if (row.childCount > 0 && !uiState.isReorderMode) {
                {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text =
                                pluralStringResource(
                                    R.plurals.group_tunnel_count,
                                    row.childCount,
                                    row.childCount,
                                ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (row.activeCount > 0) {
                            Text(
                                text = "·",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                text =
                                    stringResource(
                                        R.string.group_active_count,
                                        row.activeCount,
                                    ),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            } else null,
        onClick = {
            when {
                uiState.isReorderMode -> viewModel.enterReorderScope(row.group.id)
                uiState.isSelectionMode -> viewModel.toggleSelectedGroup(row.group.id)
                row.childCount > 0 -> viewModel.toggleGroupExpanded(row.group)
                else -> Unit
            }
        },
        selected = isDragging || uiState.selectedGroups.any { it.id == row.group.id },
        onLongClick =
            if (uiState.isReorderMode) null
            else {
                { viewModel.toggleSelectedGroup(row.group.id) }
            },
        trailing =
            // Nothing to expand into, an empty group has no chevron
            if (row.childCount > 0) {
                { _ ->
                    Icon(
                        if (row.visibleExpanded) Icons.Rounded.ExpandLess
                        else Icons.Rounded.ExpandMore,
                        contentDescription =
                            stringResource(
                                if (row.visibleExpanded) R.string.collapse_group
                                else R.string.expand_group,
                            ),
                    )
                }
            } else null,
    )
}

@Composable
private fun TunnelItemRow(
    row: TunnelListRow.TunnelRow,
    uiState: TunnelsUiState,
    viewModel: SharedAppViewModel,
    isTv: Boolean,
    isDragging: Boolean,
    focusRequester: FocusRequester?,
    onNavigateTunnel: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tunnel = row.tunnel
    val activeTunnel = uiState.backendStatus.activeTunnels[tunnel.id] ?: ActiveTunnel()
    val displayState = remember(activeTunnel) { DisplayTunnelState.from(activeTunnel) }
    val isRunning = uiState.backendStatus.activeTunnels.containsKey(tunnel.id)
    val statusLabel = stringResource(displayState.labelRes())
    val statusColors = LocalStatusColors.current
    val selected =
        remember(uiState.selectedTunnels) { uiState.selectedTunnels.any { it.id == tunnel.id } }
    SurfaceRow(
        modifier =
            modifier
                .then(if (row.grouped) Modifier.padding(start = 24.dp) else Modifier)
                .semantics { stateDescription = statusLabel },
        leading = {
            Icon(
                Icons.Rounded.Circle,
                contentDescription = null,
                tint = statusColors.colorFor(displayState.statusKind()),
                modifier = Modifier.size(14.dp),
            )
        },
        title = tunnel.name,
        description = tunnelRowDescription(tunnel, uiState, displayState),
        onClick = {
            when {
                uiState.isReorderMode -> Unit
                uiState.isSelectionMode -> viewModel.toggleSelectedTunnel(tunnel.id)
                else -> {
                    onNavigateTunnel(tunnel.id)
                    viewModel.clearSelectedTunnels()
                }
            }
        },
        selected = selected || isDragging,
        expandedContent =
            if (isRunning && !uiState.isReorderMode) {
                { TunnelStatisticsRow(activeTunnel) }
            } else {
                null
            },
        onLongClick =
            if (uiState.isReorderMode) null
            else {
                { viewModel.toggleSelectedTunnel(tunnel.id) }
            },
        trailingOutsideClickTarget = isTv,
        trailing = { rowModifier ->
            SwitchWithDivider(
                checked = isRunning,
                onClick = { checked ->
                    if (checked) {
                        viewModel.startTunnel(tunnel)
                    } else {
                        viewModel.stopTunnel(tunnel)
                    }
                },
                modifier =
                    rowModifier.then(
                        if (focusRequester != null) Modifier.focusRequester(focusRequester)
                        else Modifier,
                    ),
            )
        },
    )
}
