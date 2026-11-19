package space.ivlev.umbravpn.ui.navigation.components

import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPasteGo
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RemoveRedEye
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.NetworkCheck
import androidx.compose.material.icons.rounded.Reorder
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Route.Config
import space.ivlev.umbravpn.ui.navigation.Route.EntryTunnel
import space.ivlev.umbravpn.ui.navigation.Route.IPv6
import space.ivlev.umbravpn.ui.navigation.Route.SplitTunnel
import space.ivlev.umbravpn.ui.navigation.Route.SplitTunnelGlobal
import space.ivlev.umbravpn.ui.navigation.Route.TunnelGlobals
import space.ivlev.umbravpn.ui.navigation.Route.TunnelSettings
import space.ivlev.umbravpn.ui.navigation.Route.Tunnels
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.ui.state.NavbarState

internal fun tunnelsNavbarState(context: NavbarContext, route: Route?): NavbarState? =
    when (route) {
        is SplitTunnel,
        is SplitTunnelGlobal -> {
            val tunnelName =
                if (route is SplitTunnel) context.globalState.tunnelNames[route.id]
                else context.title(R.string.splt_tunneling)
            NavbarState(
                topLeading = context.requestBackLeading(),
                topTitle = tunnelName ?: "",
                topActionEnabled = context.screenDirty,
                topTrailing = {
                    var showOverflowMenu by remember { mutableStateOf(false) }
                    val showSystemApps by
                        context.sharedViewModel.showSplitSystemApps.collectAsStateWithLifecycle()
                    Row {
                        IconButton(
                            enabled = context.screenDirty,
                            onClick = { context.postSideEffect(LocalSideEffect.SaveChanges) },
                        ) {
                            Icon(Icons.Rounded.Save, stringResource(R.string.save))
                        }
                        IconButton(onClick = { showOverflowMenu = true }) {
                            Icon(
                                Icons.Outlined.MoreVert,
                                contentDescription = stringResource(R.string.more_options),
                            )
                        }
                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false },
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                            tonalElevation = 4.dp,
                            shadowElevation = 4.dp,
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.copy_from)) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Outlined.ContentPasteGo,
                                        contentDescription = null,
                                    )
                                },
                                onClick = {
                                    showOverflowMenu = false
                                    context.postSideEffect(LocalSideEffect.Modal.SelectTunnel)
                                },
                            )
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        stringResource(
                                            if (showSystemApps) R.string.hide_system_apps
                                            else R.string.show_system_apps,
                                        ),
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        if (showSystemApps) Icons.Outlined.VisibilityOff
                                        else Icons.Outlined.Visibility,
                                        contentDescription = null,
                                    )
                                },
                                onClick = {
                                    showOverflowMenu = false
                                    context.sharedViewModel.setShowSplitSystemApps(!showSystemApps)
                                },
                            )
                        }
                    }
                },
                showBottomItems = true,
            )
        }
        is TunnelSettings -> {
            val tunnelName = context.globalState.tunnelNames[route.id]
            NavbarState(
                topLeading = context.popBackLeading(),
                showBottomItems = true,
                topTitle = tunnelName ?: "",
            )
        }
        Tunnels -> {
            val globalState = context.globalState
            val selecting = globalState.selectedTunnelCount > 0
            NavbarState(
                topLeading =
                    when {
                        globalState.isReorderMode -> {
                            {
                                TvBackButton {
                                    if (globalState.reorderScopeTitle != null) {
                                        context.sharedViewModel.exitReorderScope()
                                    } else {
                                        context.sharedViewModel.cancelReorder()
                                    }
                                }
                            }
                        }
                        selecting -> {
                            {
                                IconButton(
                                    onClick = context.sharedViewModel::clearSelectedTunnels,
                                ) {
                                    Icon(
                                        Icons.Rounded.Close,
                                        stringResource(R.string.cancel),
                                    )
                                }
                            }
                        }
                        else -> null
                    },
                topTitle =
                    when {
                        globalState.isReorderMode && globalState.reorderScopeTitle != null ->
                            globalState.reorderScopeTitle
                        globalState.isReorderMode -> context.title(R.string.reorder)
                        selecting ->
                            context.title(
                                R.string.n_selected,
                                globalState.selectedTunnelCount,
                            )
                        else -> context.title(R.string.tunnels)
                    },
                topTrailing = {
                    when {
                        globalState.isReorderMode ->
                            Row {
                                IconButton(onClick = context.sharedViewModel::saveReorder) {
                                    Icon(
                                        Icons.Rounded.Check,
                                        stringResource(R.string.done),
                                    )
                                }
                                IconButton(
                                    onClick = {
                                        context.postSideEffect(
                                            LocalSideEffect.Sheet.ReorderActions,
                                        )
                                    },
                                ) {
                                    Icon(
                                        Icons.Outlined.MoreVert,
                                        stringResource(R.string.more_options),
                                    )
                                }
                            }
                        selecting ->
                            Row {
                                if (globalState.canMoveToGroup) {
                                    IconButton(
                                        onClick = {
                                            context.postSideEffect(
                                                LocalSideEffect.Sheet.MoveToGroup,
                                            )
                                        },
                                    ) {
                                        Icon(
                                            Icons.Outlined.Folder,
                                            stringResource(R.string.move_to_group),
                                        )
                                    }
                                }
                                IconButton(
                                    onClick = {
                                        context.postSideEffect(
                                            LocalSideEffect.Sheet.SelectionActions,
                                        )
                                    },
                                ) {
                                    Icon(
                                        Icons.Outlined.MoreVert,
                                        stringResource(R.string.more_options),
                                    )
                                }
                            }
                        else -> {
                            var showOverflowMenu by remember { mutableStateOf(false) }
                            val showTunnelMenu = globalState.tunnelNames.size > 1
                            Row {
                                if (showTunnelMenu) {
                                    IconButton(onClick = { showOverflowMenu = true }) {
                                        Icon(
                                            Icons.Outlined.MoreVert,
                                            contentDescription =
                                                stringResource(R.string.more_options),
                                        )
                                    }
                                    DropdownMenu(
                                        expanded = showOverflowMenu,
                                        onDismissRequest = { showOverflowMenu = false },
                                        containerColor =
                                            MaterialTheme.colorScheme.surface.copy(
                                                alpha = 0.8f,
                                            ),
                                        tonalElevation = 4.dp,
                                        shadowElevation = 4.dp,
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text(stringResource(R.string.reorder)) },
                                            leadingIcon = {
                                                Icon(
                                                    Icons.Rounded.Reorder,
                                                    contentDescription = null,
                                                )
                                            },
                                            onClick = {
                                                showOverflowMenu = false
                                                context.sharedViewModel.enterReorderMode()
                                            },
                                        )
                                        if (!globalState.hasActiveTunnel) {
                                            DropdownMenuItem(
                                                text = {
                                                    Text(
                                                        stringResource(R.string.ping_servers),
                                                    )
                                                },
                                                leadingIcon = {
                                                    Icon(
                                                        Icons.Rounded.NetworkCheck,
                                                        contentDescription = null,
                                                    )
                                                },
                                                onClick = {
                                                    showOverflowMenu = false
                                                    context.sharedViewModel.pingTunnels()
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                showBottomItems = true,
            )
        }
        is Config -> {
            val tunnelName = context.globalState.tunnelNames[route.id] ?: ""
            NavbarState(
                topLeading = context.popBackLeading(),
                topTrailing = {
                    var showOverflowMenu by remember { mutableStateOf(false) }
                    IconButton(
                        onClick = { context.postSideEffect(LocalSideEffect.ShowSensitive) },
                    ) {
                        Icon(
                            Icons.Outlined.RemoveRedEye,
                            stringResource(R.string.toggle_sensitive_data_visibility),
                        )
                    }

                    if (!route.live) {
                        IconButton(onClick = { showOverflowMenu = true }) {
                            Icon(
                                Icons.Outlined.MoreVert,
                                contentDescription = stringResource(R.string.more_options),
                            )
                        }

                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false },
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                            tonalElevation = 4.dp,
                            shadowElevation = 4.dp,
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.show_qr)) },
                                leadingIcon = { Icon(Icons.Default.QrCode, null) },
                                onClick = {
                                    showOverflowMenu = false
                                    context.postSideEffect(LocalSideEffect.Modal.QR)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.copy)) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Outlined.ContentCopy,
                                        contentDescription = null,
                                    )
                                },
                                onClick = {
                                    showOverflowMenu = false
                                    context.postSideEffect(LocalSideEffect.CopyToClipboard)
                                },
                            )
                        }
                    }
                },
                topTitle = tunnelName,
                showBottomItems = true,
            )
        }
        is IPv6 -> context.backTitleState(R.string.ipv6_settings)
        is EntryTunnel -> context.backTitleState(R.string.entry_tunnel)
        is TunnelGlobals -> context.backTitleState(R.string.tunnel_globals)
        else -> null
    }
