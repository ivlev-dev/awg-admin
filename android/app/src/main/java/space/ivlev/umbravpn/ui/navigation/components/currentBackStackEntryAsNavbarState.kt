package space.ivlev.umbravpn.ui.navigation.components

import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPasteGo
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RemoveRedEye
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.NetworkCheck
import androidx.compose.material.icons.rounded.Reorder
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.NavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Route.Account
import space.ivlev.umbravpn.ui.navigation.Route.AccountDeviceDetails
import space.ivlev.umbravpn.ui.navigation.Route.AccountDevices
import space.ivlev.umbravpn.ui.navigation.Route.Advanced
import space.ivlev.umbravpn.ui.navigation.Route.AndroidIntegrations
import space.ivlev.umbravpn.ui.navigation.Route.Appearance
import space.ivlev.umbravpn.ui.navigation.Route.Config
import space.ivlev.umbravpn.ui.navigation.Route.ConfigGlobal
import space.ivlev.umbravpn.ui.navigation.Route.Display
import space.ivlev.umbravpn.ui.navigation.Route.Dns
import space.ivlev.umbravpn.ui.navigation.Route.EntryTunnel
import space.ivlev.umbravpn.ui.navigation.Route.ForgotPassword
import space.ivlev.umbravpn.ui.navigation.Route.GlobalAmnezia
import space.ivlev.umbravpn.ui.navigation.Route.IPv6
import space.ivlev.umbravpn.ui.navigation.Route.Language
import space.ivlev.umbravpn.ui.navigation.Route.License
import space.ivlev.umbravpn.ui.navigation.Route.Lock
import space.ivlev.umbravpn.ui.navigation.Route.LockdownSettings
import space.ivlev.umbravpn.ui.navigation.Route.Login
import space.ivlev.umbravpn.ui.navigation.Route.Logs
import space.ivlev.umbravpn.ui.navigation.Route.Monitoring
import space.ivlev.umbravpn.ui.navigation.Route.MonitoringAndRecovery
import space.ivlev.umbravpn.ui.navigation.Route.Notifications
import space.ivlev.umbravpn.ui.navigation.Route.Onboarding
import space.ivlev.umbravpn.ui.navigation.Route.ProxySettings
import space.ivlev.umbravpn.ui.navigation.Route.Register
import space.ivlev.umbravpn.ui.navigation.Route.ResetPassword
import space.ivlev.umbravpn.ui.navigation.Route.Security
import space.ivlev.umbravpn.ui.navigation.Route.Settings
import space.ivlev.umbravpn.ui.navigation.Route.SplitTunnel
import space.ivlev.umbravpn.ui.navigation.Route.SplitTunnelGlobal
import space.ivlev.umbravpn.ui.navigation.Route.Support
import space.ivlev.umbravpn.ui.navigation.Route.TunnelGlobals
import space.ivlev.umbravpn.ui.navigation.Route.TunnelRecovery
import space.ivlev.umbravpn.ui.navigation.Route.TunnelSettings
import space.ivlev.umbravpn.ui.navigation.Route.Tunnels
import space.ivlev.umbravpn.ui.navigation.Route.VerifyPending
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.ui.state.GlobalAppUiState
import space.ivlev.umbravpn.ui.state.NavbarState
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun currentRouteAsNavbarState(
    globalState: GlobalAppUiState,
    sharedViewModel: SharedAppViewModel,
    route: Route?,
    navController: NavController,
): State<NavbarState> {
    val keyboardController = LocalSoftwareKeyboardController.current
    val context = LocalContext.current

    return remember(route, globalState) {
        derivedStateOf {
            when (route) {
                Appearance -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.appearance),
                    )
                }
                Display -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.display_theme),
                    )
                }
                Dns -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.dns_settings),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    keyboardController?.hide()
                                    sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
                                },
                            ) {
                                Icon(Icons.Rounded.Save, stringResource(R.string.save))
                            }
                        },
                    )
                }
                Language -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.language),
                    )
                }
                Notifications -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.notifications),
                    )
                }
                LockdownSettings -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.lockdown_settings),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    keyboardController?.hide()
                                    sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
                                },
                            ) {
                                Icon(Icons.Rounded.Save, stringResource(R.string.save))
                            }
                        },
                    )
                }
                License -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.licenses),
                    )
                }
                Lock -> {
                    NavbarState(showBottomItems = false)
                }
                Logs -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = false,
                        topTitle = context.getString(R.string.logs),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    sharedViewModel.postSideEffect(
                                        LocalSideEffect.Sheet.LoggerActions,
                                    )
                                },
                            ) {
                                Icon(Icons.Rounded.Menu, stringResource(R.string.quick_actions))
                            }
                        },
                    )
                }
                ProxySettings -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.proxy_settings),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    keyboardController?.hide()
                                    sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
                                },
                            ) {
                                Icon(Icons.Rounded.Save, stringResource(R.string.save))
                            }
                        },
                    )
                }
                Settings -> {
                    NavbarState(
                        showBottomItems = true,
                        topTitle = context.getString(R.string.settings),
                    )
                }
                is ConfigGlobal,
                GlobalAmnezia -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = context.getString(R.string.amnezia_for_all_tunnels),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    keyboardController?.hide()
                                    sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
                                },
                            ) {
                                Icon(Icons.Rounded.Save, stringResource(R.string.save))
                            }
                        },
                    )
                }
                is SplitTunnel,
                is SplitTunnelGlobal -> {
                    val tunnelName =
                        if (route is SplitTunnel) globalState.tunnelNames[route.id]
                        else context.getString(R.string.splt_tunneling)
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = tunnelName ?: "",
                        topTrailing = {
                            var showOverflowMenu by remember { mutableStateOf(false) }
                            val showSystemApps by
                                sharedViewModel.showSplitSystemApps.collectAsStateWithLifecycle()
                            Row {
                                IconButton(
                                    onClick = {
                                        sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
                                    },
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
                                    containerColor =
                                        MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
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
                                            sharedViewModel.postSideEffect(
                                                LocalSideEffect.Modal.SelectTunnel,
                                            )
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
                                            sharedViewModel.setShowSplitSystemApps(!showSystemApps)
                                        },
                                    )
                                }
                            }
                        },
                        showBottomItems = true,
                    )
                }
                Support -> {
                    NavbarState(
                        topTitle = context.getString(R.string.support),
                        showBottomItems = true,
                    )
                }
                AndroidIntegrations -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.android_integrations),
                        showBottomItems = true,
                    )
                }
                is TunnelSettings -> {
                    val tunnelName = globalState.tunnelNames[route.id]
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        showBottomItems = true,
                        topTitle = tunnelName ?: "",
                    )
                }
                Tunnels -> {
                    val selecting = globalState.selectedTunnelCount > 0
                    NavbarState(
                        topLeading =
                            when {
                                globalState.isReorderMode -> {
                                    {
                                        TvBackButton {
                                            if (globalState.reorderScopeTitle != null) {
                                                sharedViewModel.exitReorderScope()
                                            } else {
                                                sharedViewModel.cancelReorder()
                                            }
                                        }
                                    }
                                }
                                selecting -> {
                                    {
                                        IconButton(
                                            onClick = sharedViewModel::clearSelectedTunnels,
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
                                globalState.isReorderMode &&
                                    globalState.reorderScopeTitle != null ->
                                    globalState.reorderScopeTitle
                                globalState.isReorderMode -> context.getString(R.string.reorder)
                                selecting ->
                                    context.getString(
                                        R.string.n_selected,
                                        globalState.selectedTunnelCount,
                                    )
                                else -> context.getString(R.string.tunnels)
                            },
                        topTrailing = {
                            when {
                                globalState.isReorderMode ->
                                    Row {
                                        IconButton(onClick = sharedViewModel::saveReorder) {
                                            Icon(
                                                Icons.Rounded.Check,
                                                stringResource(R.string.done),
                                            )
                                        }
                                        IconButton(
                                            onClick = {
                                                sharedViewModel.postSideEffect(
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
                                                    sharedViewModel.postSideEffect(
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
                                                sharedViewModel.postSideEffect(
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
                                                    text = {
                                                        Text(stringResource(R.string.reorder))
                                                    },
                                                    leadingIcon = {
                                                        Icon(
                                                            Icons.Rounded.Reorder,
                                                            contentDescription = null,
                                                        )
                                                    },
                                                    onClick = {
                                                        showOverflowMenu = false
                                                        sharedViewModel.enterReorderMode()
                                                    },
                                                )
                                                if (!globalState.hasActiveTunnel) {
                                                    DropdownMenuItem(
                                                        text = {
                                                            Text(
                                                                stringResource(
                                                                    R.string.ping_servers,
                                                                ),
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
                                                            sharedViewModel.pingTunnels()
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
                    val tunnelName = globalState.tunnelNames[route.id] ?: ""
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTrailing = {
                            var showOverflowMenu by remember { mutableStateOf(false) }
                            IconButton(
                                onClick = {
                                    sharedViewModel.postSideEffect(LocalSideEffect.ShowSensitive)
                                },
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
                                    containerColor =
                                        MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                                    tonalElevation = 4.dp,
                                    shadowElevation = 4.dp,
                                ) {
                                    DropdownMenuItem(
                                        text = { Text(stringResource(R.string.show_qr)) },
                                        leadingIcon = { Icon(Icons.Default.QrCode, null) },
                                        onClick = {
                                            showOverflowMenu = false
                                            sharedViewModel.postSideEffect(LocalSideEffect.Modal.QR)
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
                                            sharedViewModel.postSideEffect(
                                                LocalSideEffect.CopyToClipboard,
                                            )
                                        },
                                    )
                                }
                            }
                        },
                        topTitle = tunnelName,
                        showBottomItems = true,
                    )
                }
                is IPv6 -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.ipv6_settings),
                        showBottomItems = true,
                    )
                }
                is EntryTunnel -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.entry_tunnel),
                        showBottomItems = true,
                    )
                }
                is TunnelGlobals -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.tunnel_globals),
                        showBottomItems = true,
                    )
                }
                is Advanced -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.advanced),
                        showBottomItems = true,
                    )
                }
                is Security -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.security),
                        showBottomItems = true,
                    )
                }
                is Monitoring -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.monitoring),
                        showBottomItems = true,
                    )
                }
                is TunnelRecovery,
                is MonitoringAndRecovery -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle =
                            context.getString(
                                if (route is MonitoringAndRecovery) R.string.monitoring_and_recovery
                                else R.string.tunnel_recovery,
                            ),
                        topTrailing = {
                            IconButton(
                                onClick = {
                                    sharedViewModel.postSideEffect(
                                        LocalSideEffect.Modal.RecoveryDetails,
                                    )
                                },
                            ) {
                                Icon(
                                    Icons.Outlined.Info,
                                    contentDescription = stringResource(R.string.recovery_details),
                                )
                            }
                        },
                        showBottomItems = true,
                    )
                }
                null -> {
                    NavbarState()
                }
                Onboarding -> {
                    NavbarState(showBottomItems = false)
                }
                Login -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_login_title),
                        showBottomItems = false,
                    )
                }
                Register -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_register_title),
                        showBottomItems = false,
                    )
                }
                is VerifyPending -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_verify_title),
                        showBottomItems = false,
                    )
                }
                ForgotPassword -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_forgot_title),
                        showBottomItems = false,
                    )
                }
                ResetPassword -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_reset_title),
                        showBottomItems = false,
                    )
                }
                Account -> {
                    NavbarState(
                        topTitle = context.getString(R.string.account),
                        showBottomItems = true,
                    )
                }
                AccountDevices -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_devices_title),
                        showBottomItems = true,
                    )
                }
                is AccountDeviceDetails -> {
                    NavbarState(
                        topLeading = { TvBackButton { navController.pop() } },
                        topTitle = context.getString(R.string.account_device_details),
                        showBottomItems = true,
                    )
                }
            }
        }
    }
}
