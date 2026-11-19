package space.ivlev.umbravpn.ui.navigation

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import org.koin.androidx.compose.koinViewModel
import org.koin.core.parameter.parametersOf
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.ui.screens.account.AccessBlockedScreen
import space.ivlev.umbravpn.ui.screens.account.AccountDeviceDetailsScreen
import space.ivlev.umbravpn.ui.screens.account.AccountDevicesScreen
import space.ivlev.umbravpn.ui.screens.account.AccountScreen
import space.ivlev.umbravpn.ui.screens.account.ForgotPasswordScreen
import space.ivlev.umbravpn.ui.screens.account.LoginScreen
import space.ivlev.umbravpn.ui.screens.account.OnboardingScreen
import space.ivlev.umbravpn.ui.screens.account.RegisterScreen
import space.ivlev.umbravpn.ui.screens.account.ResetPasswordScreen
import space.ivlev.umbravpn.ui.screens.account.SessionExpiredScreen
import space.ivlev.umbravpn.ui.screens.account.VerifyPendingScreen
import space.ivlev.umbravpn.ui.screens.pin.PinLockScreen
import space.ivlev.umbravpn.ui.screens.settings.SettingsScreen
import space.ivlev.umbravpn.ui.screens.settings.advanced.AdvancedScreen
import space.ivlev.umbravpn.ui.screens.settings.amnezia.GlobalAmneziaScreen
import space.ivlev.umbravpn.ui.screens.settings.appearance.AppearanceScreen
import space.ivlev.umbravpn.ui.screens.settings.appearance.display.DisplayScreen
import space.ivlev.umbravpn.ui.screens.settings.appearance.language.LanguageScreen
import space.ivlev.umbravpn.ui.screens.settings.appearance.notifications.NotificationsScreen
import space.ivlev.umbravpn.ui.screens.settings.dns.DnsSettingsScreen
import space.ivlev.umbravpn.ui.screens.settings.integrations.AndroidIntegrationsScreen
import space.ivlev.umbravpn.ui.screens.settings.lockdown.LockdownSettingsScreen
import space.ivlev.umbravpn.ui.screens.settings.logs.LogsScreen
import space.ivlev.umbravpn.ui.screens.settings.monitoring.MonitoringScreen
import space.ivlev.umbravpn.ui.screens.settings.proxy.ProxySettingsScreen
import space.ivlev.umbravpn.ui.screens.settings.security.SecurityScreen
import space.ivlev.umbravpn.ui.screens.support.SupportScreen
import space.ivlev.umbravpn.ui.screens.support.license.LicenseScreen
import space.ivlev.umbravpn.ui.screens.tunnels.TunnelsScreen
import space.ivlev.umbravpn.ui.screens.tunnels.settings.TunnelSettingsScreen
import space.ivlev.umbravpn.ui.screens.tunnels.settings.config.ConfigScreen
import space.ivlev.umbravpn.ui.screens.tunnels.settings.entry.EntryTunnelScreen
import space.ivlev.umbravpn.ui.screens.tunnels.settings.ipv6.IPv6Screen
import space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.SplitTunnelScreen
import space.ivlev.umbravpn.viewmodel.SplitTunnelViewModel
import space.ivlev.umbravpn.viewmodel.TunnelViewModel

@Composable
fun AppNavDisplay(
    backStack: NavBackStack<NavKey>,
    navController: NavController,
    previousRoute: Route?,
    currentRoute: Route?,
    session: SessionState,
    onSwitchAccount: () -> Unit,
    onOpenSupport: () -> Unit,
    onSessionExpiredSignIn: () -> Unit,
) {
    NavDisplay(
        backStack = backStack,
        modifier = Modifier.fillMaxSize(),
        onBack = { navController.pop() },
        transitionSpec = { appNavTransitionSpec(previousRoute, currentRoute) },
        popTransitionSpec = {
            (slideInHorizontally { -it } + fadeIn()) togetherWith
                (slideOutHorizontally { it } + fadeOut())
        },
        predictivePopTransitionSpec = {
            (slideInHorizontally { -it } + fadeIn()) togetherWith
                (slideOutHorizontally { it } + fadeOut())
        },
        entryDecorators =
            listOf(
                rememberSaveableStateHolderNavEntryDecorator(),
                rememberViewModelStoreNavEntryDecorator(),
            ),
        entryProvider =
            appEntryProvider(
                session = session,
                onSwitchAccount = onSwitchAccount,
                onOpenSupport = onOpenSupport,
                onSessionExpiredSignIn = onSessionExpiredSignIn,
            ),
    )
}

internal fun appNavTransitionSpec(
    previousRoute: Route?,
    currentRoute: Route?,
): ContentTransform {
    val initialIndex = previousRoute?.let(Tab::fromRoute)?.index ?: 0
    val targetIndex = currentRoute?.let(Tab::fromRoute)?.index ?: 0
    return if (initialIndex != targetIndex) {
        val dir = if (targetIndex > initialIndex) 1 else -1
        (slideInHorizontally { dir * it } + fadeIn()) togetherWith
            (slideOutHorizontally { dir * -it } + fadeOut())
    } else {
        (slideInHorizontally { it } + fadeIn()) togetherWith
            (slideOutHorizontally { -it } + fadeOut())
    }
}

@Composable
internal fun appEntryProvider(
    session: SessionState,
    onSwitchAccount: () -> Unit,
    onOpenSupport: () -> Unit,
    onSessionExpiredSignIn: () -> Unit,
): (NavKey) -> NavEntry<NavKey> = entryProvider {
    entry<Route.Lock> { PinLockScreen() }
    entry<Route.Onboarding> { OnboardingScreen() }
    entry<Route.Login> { LoginScreen() }
    entry<Route.AccessBlocked> {
        val blocked = session as? SessionState.Blocked
        AccessBlockedScreen(
            reason = blocked?.reason ?: BlockReason.Disabled,
            email = blocked?.email,
            onSwitchAccount = onSwitchAccount,
            onSupport = onOpenSupport,
        )
    }
    entry<Route.SessionExpired> { SessionExpiredScreen(onSignIn = onSessionExpiredSignIn) }
    entry<Route.Register> { RegisterScreen() }
    entry<Route.VerifyPending> { key -> VerifyPendingScreen(key.email) }
    entry<Route.ForgotPassword> { ForgotPasswordScreen() }
    entry<Route.ResetPassword> { ResetPasswordScreen() }
    entry<Route.Account> { AccountScreen() }
    entry<Route.AccountDevices> { AccountDevicesScreen() }
    entry<Route.AccountDeviceDetails> { key -> AccountDeviceDetailsScreen(key.id) }
    entry<Route.Tunnels> { TunnelsScreen() }
    entry<Route.TunnelSettings> { key ->
        val viewModel: TunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        TunnelSettingsScreen(viewModel)
    }
    entry<Route.Config> { key ->
        val viewModel: TunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        ConfigScreen(viewModel, key.live)
    }
    entry<Route.SplitTunnel> { key ->
        val viewModel: SplitTunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        SplitTunnelScreen(viewModel)
    }
    entry<Route.Settings> { SettingsScreen() }
    entry<Route.AndroidIntegrations> { AndroidIntegrationsScreen() }
    entry<Route.Dns> { DnsSettingsScreen() }
    entry<Route.ConfigGlobal> { GlobalAmneziaScreen() }
    entry<Route.GlobalAmnezia> { GlobalAmneziaScreen() }
    entry<Route.SplitTunnelGlobal> { key ->
        val viewModel: SplitTunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        SplitTunnelScreen(viewModel)
    }
    entry<Route.IPv6> { key ->
        val viewModel: TunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        IPv6Screen(viewModel)
    }
    entry<Route.EntryTunnel> { key ->
        val viewModel: TunnelViewModel = koinViewModel(parameters = { parametersOf(key.id) })
        EntryTunnelScreen(viewModel)
    }
    entry<Route.LockdownSettings> { LockdownSettingsScreen() }
    entry<Route.ProxySettings> { ProxySettingsScreen() }
    entry<Route.Appearance> { AppearanceScreen() }
    entry<Route.Language> { LanguageScreen() }
    entry<Route.Display> { DisplayScreen() }
    entry<Route.Notifications> { NotificationsScreen() }
    entry<Route.Logs> { LogsScreen() }
    entry<Route.Support> { SupportScreen() }
    entry<Route.License> { LicenseScreen() }
    entry<Route.TunnelGlobals> { AdvancedScreen() }
    entry<Route.Advanced> { AdvancedScreen() }
    entry<Route.Security> { SecurityScreen() }
    entry<Route.Monitoring> { MonitoringScreen() }
    entry<Route.TunnelRecovery> { MonitoringScreen() }
    entry<Route.MonitoringAndRecovery> { MonitoringScreen() }
}
