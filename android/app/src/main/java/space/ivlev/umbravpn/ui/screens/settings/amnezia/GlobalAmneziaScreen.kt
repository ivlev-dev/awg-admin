package space.ivlev.umbravpn.ui.screens.settings.amnezia

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinActivityViewModel
import org.koin.compose.viewmodel.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.common.banner.InfoNotice
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.common.dialog.rememberRestartToApplyChanges
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.screens.tunnels.settings.config.edit.components.AmneziaSection
import space.ivlev.umbravpn.ui.screens.tunnels.settings.config.edit.components.AmneziaToolMenuItems
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.viewmodel.GlobalAmneziaViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun GlobalAmneziaScreen(
    viewModel: GlobalAmneziaViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val uiState by viewModel.collectAsState()
    var showDiscardDialog by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(uiState.isDirty) { sharedViewModel.setScreenDirty(uiState.isDirty) }
    DisposableEffect(Unit) { onDispose { sharedViewModel.setScreenDirty(false) } }
    BackHandler(enabled = uiState.isDirty) { showDiscardDialog = true }

    if (showDiscardDialog) {
        InfoDialog(
            onDismiss = { showDiscardDialog = false },
            onAttest = {
                showDiscardDialog = false
                navController.pop()
            },
            title = stringResource(R.string.discard_changes_title),
            body = { Text(stringResource(R.string.discard_changes_body)) },
            confirmText = stringResource(R.string.discard_changes_confirm),
            destructive = true,
        )
    }

    if (uiState.isLoading) {
        LoadingPlaceholder()
        return
    }

    var menuExpanded by rememberSaveable { mutableStateOf(false) }
    val requestApply =
        rememberRestartToApplyChanges(
            needsRestart = uiState.tunnelActive && uiState.enabled,
            onSave = viewModel::save,
        )

    sharedViewModel.collectSideEffect { effect ->
        when (effect) {
            is LocalSideEffect.SaveChanges -> requestApply()
            is LocalSideEffect.RequestBack ->
                if (uiState.isDirty) showDiscardDialog = true else navController.pop()
            else -> Unit
        }
    }

    Column(
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Top),
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
    ) {
        InfoNotice(
            title = stringResource(R.string.amnezia_options_saved_until_enabled),
            visible = !uiState.enabled,
        )
        Column {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp),
            ) {
                GroupLabel(stringResource(R.string.amnezia_for_all_tunnels))
                Column {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(
                            Icons.Rounded.MoreVert,
                            contentDescription = stringResource(R.string.quick_actions),
                        )
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                    ) {
                        AmneziaToolMenuItems(
                            compatibilitySet =
                                uiState.interfaceDraft.isAmneziaCompatibilityModeSet(),
                            onToggleCompatibility = {
                                menuExpanded = false
                                viewModel.toggleAmneziaCompat()
                            },
                            onMimic = { mimic ->
                                menuExpanded = false
                                viewModel.onMimic(mimic)
                            },
                        )
                    }
                }
            }
            AmneziaSection(
                interfaceState = uiState.interfaceDraft,
                onInterfaceChange = viewModel::onInterfaceChange,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
    }
}
