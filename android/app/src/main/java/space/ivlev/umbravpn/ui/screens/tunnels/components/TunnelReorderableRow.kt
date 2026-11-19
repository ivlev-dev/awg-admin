package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import sh.calvin.reorderable.DragGestureDetector
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.ReorderableLazyListState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.ExpandingRowListItem
import space.ivlev.umbravpn.ui.state.TunnelListRow
import space.ivlev.umbravpn.ui.state.TunnelsUiState

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun LazyItemScope.ReorderableTunnelRow(
    reorderableState: ReorderableLazyListState,
    row: TunnelListRow,
    index: Int,
    rowCount: Int,
    uiState: TunnelsUiState,
    isTv: Boolean,
    onEnterScope: (Int) -> Unit,
    onMove: (from: Int, to: Int) -> Unit,
) {
    val hapticFeedback = LocalHapticFeedback.current

    ReorderableItem(reorderableState, row.key) { isDragging ->
        val latency =
            (row as? TunnelListRow.TunnelRow)?.let { uiState.reorderLatencies[it.tunnel.id] }
        val latencyLabel = latency?.let { pingLatencyLabel(it) }
        val latencyColor = latency?.let { pingLatencyColor(it) }
        val title = buildAnnotatedString {
            when (row) {
                is TunnelListRow.GroupHeader -> {
                    // Not pinged as a unit, so there's no latency for a header
                    append(
                        if (row.childCount == 0) row.group.name
                        else
                            stringResource(
                                R.string.group_with_count,
                                row.group.name,
                                row.childCount,
                            ),
                    )
                }
                is TunnelListRow.TunnelRow -> {
                    append(row.tunnel.name)
                    if (latency != null && latencyLabel != null && latencyColor != null) {
                        append(" - ")
                        withStyle(SpanStyle(color = latencyColor)) { append(latencyLabel) }
                    }
                }
            }
        }
        ExpandingRowListItem(
            leading = {
                if (row is TunnelListRow.GroupHeader) {
                    Icon(
                        Icons.Outlined.Folder,
                        contentDescription = row.group.name,
                        modifier = Modifier.size(20.dp),
                    )
                }
            },
            text = title,
            // Whole row, not just the folder icon, so it's an easy tap target
            onClick =
                if (row is TunnelListRow.GroupHeader && row.childCount > 0) {
                    { onEnterScope(row.group.id) }
                } else {
                    null
                },
            trailing = {
                if (!isTv) {
                    Icon(Icons.Default.DragHandle, stringResource(R.string.drag_handle))
                } else {
                    Row {
                        IconButton(
                            onClick = { onMove(index, index - 1) },
                            enabled = index != 0,
                        ) {
                            Icon(
                                Icons.Default.ArrowUpward,
                                stringResource(R.string.move_up),
                            )
                        }
                        IconButton(
                            onClick = { onMove(index, index + 1) },
                            enabled = index != rowCount - 1,
                        ) {
                            Icon(
                                Icons.Default.ArrowDownward,
                                stringResource(R.string.move_down),
                            )
                        }
                    }
                }
            },
            isSelected = isDragging,
            expanded = {},
            modifier =
                if (!isTv)
                    Modifier.draggableHandle(
                        onDragStarted = {
                            hapticFeedback.performHapticFeedback(
                                HapticFeedbackType.GestureThresholdActivate,
                            )
                        },
                        onDragStopped = {
                            hapticFeedback.performHapticFeedback(HapticFeedbackType.GestureEnd)
                        },
                        dragGestureDetector = DragGestureDetector.LongPress,
                    )
                else Modifier,
        )
    }
}
