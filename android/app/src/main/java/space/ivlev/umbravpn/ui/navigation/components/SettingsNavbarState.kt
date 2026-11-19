package space.ivlev.umbravpn.ui.navigation.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Route.Advanced
import space.ivlev.umbravpn.ui.navigation.Route.Appearance
import space.ivlev.umbravpn.ui.navigation.Route.ConfigGlobal
import space.ivlev.umbravpn.ui.navigation.Route.Display
import space.ivlev.umbravpn.ui.navigation.Route.Dns
import space.ivlev.umbravpn.ui.navigation.Route.GlobalAmnezia
import space.ivlev.umbravpn.ui.navigation.Route.Language
import space.ivlev.umbravpn.ui.navigation.Route.License
import space.ivlev.umbravpn.ui.navigation.Route.Lock
import space.ivlev.umbravpn.ui.navigation.Route.LockdownSettings
import space.ivlev.umbravpn.ui.navigation.Route.Logs
import space.ivlev.umbravpn.ui.navigation.Route.Monitoring
import space.ivlev.umbravpn.ui.navigation.Route.MonitoringAndRecovery
import space.ivlev.umbravpn.ui.navigation.Route.Notifications
import space.ivlev.umbravpn.ui.navigation.Route.ProxySettings
import space.ivlev.umbravpn.ui.navigation.Route.Security
import space.ivlev.umbravpn.ui.navigation.Route.Settings
import space.ivlev.umbravpn.ui.navigation.Route.TunnelRecovery
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.ui.state.NavbarState

internal fun settingsNavbarState(context: NavbarContext, route: Route?): NavbarState? =
    when (route) {
        Appearance -> context.backTitleState(R.string.appearance)
        Display -> context.backTitleState(R.string.display_theme)
        Dns ->
            NavbarState(
                topLeading = context.requestBackLeading(),
                showBottomItems = true,
                topTitle = context.title(R.string.dns_settings),
                topActionEnabled = context.screenDirty,
                topTrailing = context.saveTrailing(),
            )
        Language -> context.backTitleState(R.string.language)
        Notifications -> context.backTitleState(R.string.notifications)
        LockdownSettings ->
            NavbarState(
                topLeading = context.popBackLeading(),
                showBottomItems = true,
                topTitle = context.title(R.string.lockdown_settings),
                topTrailing = context.saveTrailing(enabled = true),
            )
        License -> context.backTitleState(R.string.licenses)
        Lock -> NavbarState(showBottomItems = false)
        Logs ->
            NavbarState(
                topLeading = context.popBackLeading(),
                showBottomItems = false,
                topTitle = context.title(R.string.logs),
                topTrailing = {
                    IconButton(
                        onClick = { context.postSideEffect(LocalSideEffect.Sheet.LoggerActions) },
                    ) {
                        Icon(
                            Icons.Rounded.Menu,
                            stringResource(R.string.quick_actions),
                        )
                    }
                },
            )
        ProxySettings ->
            NavbarState(
                topLeading = context.requestBackLeading(),
                showBottomItems = true,
                topTitle = context.title(R.string.proxy_settings),
                topActionEnabled = context.screenDirty,
                topTrailing = context.saveTrailing(),
            )
        Settings ->
            NavbarState(
                showBottomItems = true,
                topTitle = context.title(R.string.settings),
            )
        is ConfigGlobal,
        GlobalAmnezia ->
            NavbarState(
                topLeading = context.requestBackLeading(),
                showBottomItems = true,
                topTitle = context.title(R.string.amnezia_for_all_tunnels),
                topActionEnabled = context.screenDirty,
                topTrailing = context.saveTrailing(),
            )
        Advanced -> context.backTitleState(R.string.advanced)
        Security -> context.backTitleState(R.string.security)
        Monitoring -> context.backTitleState(R.string.monitoring)
        is TunnelRecovery,
        is MonitoringAndRecovery ->
            NavbarState(
                topLeading = context.popBackLeading(),
                topTitle =
                    context.title(
                        if (route is MonitoringAndRecovery) R.string.monitoring_and_recovery
                        else R.string.tunnel_recovery,
                    ),
                topTrailing = {
                    IconButton(
                        onClick = { context.postSideEffect(LocalSideEffect.Modal.RecoveryDetails) },
                    ) {
                        Icon(
                            Icons.Outlined.Info,
                            contentDescription = stringResource(R.string.recovery_details),
                        )
                    }
                },
                showBottomItems = true,
            )
        else -> null
    }
