package space.ivlev.umbravpn.ui.screens.tunnels

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.NetworkCheck
import androidx.compose.material.icons.rounded.SortByAlpha
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dokar.sonner.ToastType
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.ui.LocalIsAndroidTV
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.common.functions.rememberFileExportLauncherForResult
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.ui.screens.tunnels.components.GroupNameDialog
import space.ivlev.umbravpn.ui.screens.tunnels.components.GroupSelectionSheet
import space.ivlev.umbravpn.ui.screens.tunnels.components.SelectionActionsSheet
import space.ivlev.umbravpn.ui.screens.tunnels.components.TunnelList
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.extensions.asExportFileName
import space.ivlev.umbravpn.util.extensions.asFileExportName
import space.ivlev.umbravpn.util.extensions.hasSAFSupport
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun TunnelsScreen(sharedViewModel: SharedAppViewModel = koinActivityViewModel()) {
    val context = LocalContext.current
    val isTv = LocalIsAndroidTV.current

    val uiState by sharedViewModel.tunnelsUiState.collectAsStateWithLifecycle()

    if (uiState.isLoading) return

    val selectedTunnelsExportLauncher =
        rememberFileExportLauncherForResult(
            mimeType = FileUtils.ALL_FILE_TYPES,
            onSuccess = { uri -> sharedViewModel.exportSelectedTunnels(uri) },
            onCanceled = {
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(R.string.export_canceled),
                    ToastType.Warning,
                )
            },
            onUnsupported = { sharedViewModel.exportSelectedTunnels(uri = null) },
        )

    var showDeleteModal by rememberSaveable { mutableStateOf(false) }
    var showMoveToGroup by rememberSaveable { mutableStateOf(false) }
    var showSelectionActions by rememberSaveable { mutableStateOf(false) }
    var showReorderActions by rememberSaveable { mutableStateOf(false) }
    var renameGroup by remember { mutableStateOf<TunnelGroup?>(null) }
    var deleteGroup by remember { mutableStateOf<TunnelGroup?>(null) }
    var deleteGroupAndTunnels by remember { mutableStateOf<TunnelGroup?>(null) }
    var exportGroup by remember { mutableStateOf<TunnelGroup?>(null) }

    sharedViewModel.collectSideEffect { sideEffect ->
        when (sideEffect) {
            LocalSideEffect.Sheet.MoveToGroup -> showMoveToGroup = true
            LocalSideEffect.Sheet.SelectionActions -> showSelectionActions = true
            LocalSideEffect.Sheet.ReorderActions -> showReorderActions = true
            LocalSideEffect.LaunchExportPicker -> {
                val (fileName, mimeType) = uiState.tunnelsForExport.asFileExportName()
                // Fallback, especially for TV, for downloads export
                if (isTv && !context.hasSAFSupport(mimeType)) {
                    sharedViewModel.exportSelectedTunnels(uri = null)
                } else {
                    selectedTunnelsExportLauncher.launch(fileName)
                }
            }
            LocalSideEffect.SelectedTunnels.SelectAll -> sharedViewModel.toggleSelectAllTunnels()
            else -> Unit
        }
    }

    BackHandler(enabled = uiState.isReorderMode || uiState.isSelectionMode) {
        when {
            uiState.isReorderMode && uiState.reorderScopeGroupId != null ->
                sharedViewModel.exitReorderScope()
            uiState.isReorderMode -> sharedViewModel.cancelReorder()
            else -> sharedViewModel.clearSelectedTunnels()
        }
    }

    val groupExportLauncher =
        rememberFileExportLauncherForResult(
            onSuccess = { uri ->
                exportGroup?.let { sharedViewModel.exportGroup(it, uri) }
                exportGroup = null
            },
            onCanceled = {
                exportGroup = null
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(R.string.export_canceled),
                    ToastType.Warning,
                )
            },
            onUnsupported = {
                exportGroup?.let { sharedViewModel.exportGroup(it, uri = null) }
                exportGroup = null
            },
        )

    if (showDeleteModal) {
        InfoDialog(
            onDismiss = { showDeleteModal = false },
            onAttest = {
                sharedViewModel.deleteSelectedTunnels()
                showDeleteModal = false
            },
            title =
                stringResource(
                    if (uiState.selectedTunnels.isEmpty() && uiState.selectedGroups.isNotEmpty())
                        R.string.delete_group
                    else R.string.delete_tunnel,
                ),
            body = {
                Text(
                    text =
                        stringResource(
                            if (
                                uiState.selectedTunnels.isEmpty() &&
                                    uiState.selectedGroups.isNotEmpty()
                            )
                                R.string.delete_group_message
                            else R.string.delete_tunnel_message,
                        ),
                )
            },
            confirmText = stringResource(R.string.yes),
        )
    }

    renameGroup?.let { group ->
        GroupNameDialog(
            title = stringResource(R.string.rename_group),
            initialName = group.name,
            onDismiss = { renameGroup = null },
            onConfirm = { name ->
                sharedViewModel.renameGroup(group, name)
                renameGroup = null
            },
        )
    }

    if (showMoveToGroup) {
        GroupSelectionSheet(
            groups = uiState.groups,
            tunnels = uiState.tunnels,
            selectedCount = uiState.selectedTunnels.size,
            onCreateGroup = { name -> sharedViewModel.createGroupAndMoveSelected(name) },
            onMoveToGroup = { groupId -> sharedViewModel.moveSelectedToGroup(groupId) },
            onDismiss = { showMoveToGroup = false },
        )
    }

    if (showSelectionActions) {
        SelectionActionsSheet(
            uiState = uiState,
            onDismiss = { showSelectionActions = false },
            onSelectAll = sharedViewModel::toggleSelectAllTunnels,
            onUngroup = sharedViewModel::ungroupSelected,
            onExport = {
                val (fileName, mimeType) = uiState.tunnelsForExport.asFileExportName()
                if (isTv && !context.hasSAFSupport(mimeType)) {
                    sharedViewModel.exportSelectedTunnels(uri = null)
                } else {
                    selectedTunnelsExportLauncher.launch(fileName)
                }
            },
            onDelete = { showDeleteModal = true },
            onRenameGroup = { renameGroup = it },
            onExportGroup = { group ->
                exportGroup = group
                val (fileName, mimeType) = group.asExportFileName()
                if (isTv && !context.hasSAFSupport(mimeType)) {
                    sharedViewModel.exportGroup(group, uri = null)
                    exportGroup = null
                } else {
                    groupExportLauncher.launch(fileName)
                }
            },
            onDeleteGroup = { deleteGroup = it },
            onDeleteGroupAndTunnels = { deleteGroupAndTunnels = it },
        )
    }

    if (showReorderActions) {
        CustomBottomSheet(
            listOf(
                SheetOption(
                    Icons.Rounded.SortByAlpha,
                    stringResource(R.string.sort_by_name),
                    onClick = {
                        showReorderActions = false
                        sharedViewModel.sortReorderByName()
                    },
                ),
                SheetOption(
                    Icons.Rounded.NetworkCheck,
                    stringResource(R.string.sort_by_latency),
                    onClick = {
                        showReorderActions = false
                        sharedViewModel.sortReorderByLatency()
                    },
                ),
            ),
        ) {
            showReorderActions = false
        }
    }

    deleteGroup?.let { group ->
        InfoDialog(
            onDismiss = { deleteGroup = null },
            onAttest = {
                sharedViewModel.ungroup(group)
                deleteGroup = null
            },
            title = stringResource(R.string.delete_group),
            body = { Text(text = stringResource(R.string.delete_group_message)) },
            confirmText = stringResource(R.string.yes),
        )
    }

    deleteGroupAndTunnels?.let { group ->
        InfoDialog(
            onDismiss = { deleteGroupAndTunnels = null },
            onAttest = {
                sharedViewModel.deleteGroupAndTunnels(group)
                deleteGroupAndTunnels = null
            },
            title = stringResource(R.string.delete_group_and_tunnels),
            body = { Text(text = stringResource(R.string.delete_group_and_tunnels_message)) },
            confirmText = stringResource(R.string.yes),
        )
    }

    TunnelList(uiState, Modifier.fillMaxSize(), sharedViewModel)
}
