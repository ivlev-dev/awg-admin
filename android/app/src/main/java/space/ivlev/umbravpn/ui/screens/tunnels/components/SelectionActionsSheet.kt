package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FolderOff
import androidx.compose.material.icons.outlined.SelectAll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.ui.state.TunnelsUiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectionActionsSheet(
    uiState: TunnelsUiState,
    onDismiss: () -> Unit,
    onSelectAll: () -> Unit,
    onUngroup: () -> Unit,
    onExport: () -> Unit,
    onDelete: () -> Unit,
    onRenameGroup: (TunnelGroup) -> Unit,
    onExportGroup: (TunnelGroup) -> Unit,
    onDeleteGroup: (TunnelGroup) -> Unit,
    onDeleteGroupAndTunnels: (TunnelGroup) -> Unit,
) {
    val singleGroup =
        uiState.selectedGroups.singleOrNull().takeIf { uiState.selectedTunnels.isEmpty() }
    val singleGroupHasTunnels =
        singleGroup != null && uiState.tunnels.any { it.groupId == singleGroup.id }

    CustomBottomSheet(
        buildList {
            add(
                SheetOption(
                    Icons.Outlined.SelectAll,
                    stringResource(R.string.select_all),
                    onClick = {
                        onDismiss()
                        onSelectAll()
                    },
                ),
            )
            if (singleGroup != null) {
                add(
                    SheetOption(
                        Icons.Outlined.Edit,
                        stringResource(R.string.rename_group),
                        onClick = {
                            onDismiss()
                            onRenameGroup(singleGroup)
                        },
                    ),
                )
                if (singleGroupHasTunnels) {
                    add(
                        SheetOption(
                            Icons.Outlined.Download,
                            stringResource(R.string.export_group),
                            onClick = {
                                onDismiss()
                                onExportGroup(singleGroup)
                            },
                        ),
                    )
                }
                add(
                    SheetOption(
                        Icons.Outlined.Delete,
                        stringResource(R.string.delete_group),
                        onClick = {
                            onDismiss()
                            onDeleteGroup(singleGroup)
                        },
                    ),
                )
                if (singleGroupHasTunnels) {
                    add(
                        SheetOption(
                            Icons.Outlined.DeleteForever,
                            stringResource(R.string.delete_group_and_tunnels),
                            onClick = {
                                onDismiss()
                                onDeleteGroupAndTunnels(singleGroup)
                            },
                        ),
                    )
                }
            } else {
                if (uiState.canUngroup) {
                    add(
                        SheetOption(
                            Icons.Outlined.FolderOff,
                            stringResource(R.string.ungroup),
                            onClick = {
                                onDismiss()
                                onUngroup()
                            },
                        ),
                    )
                }
                add(
                    SheetOption(
                        Icons.Outlined.Download,
                        stringResource(R.string.download),
                        onClick = {
                            onDismiss()
                            onExport()
                        },
                    ),
                )
                add(
                    SheetOption(
                        Icons.Outlined.Delete,
                        stringResource(R.string.delete),
                        onClick = {
                            onDismiss()
                            onDelete()
                        },
                    ),
                )
            }
        },
    ) {
        onDismiss()
    }
}
