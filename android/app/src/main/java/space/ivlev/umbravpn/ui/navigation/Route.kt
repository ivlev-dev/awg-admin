package space.ivlev.umbravpn.ui.navigation

import androidx.annotation.Keep
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QuestionMark
import androidx.compose.material.icons.outlined.Settings
import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable
import space.ivlev.umbravpn.R

@Keep
@Serializable
sealed class Route : NavKey {

    @Keep @Serializable data object Support : Route()

    @Keep @Serializable data object Onboarding : Route()

    @Keep @Serializable data object Login : Route()

    @Keep @Serializable data object Register : Route()

    @Keep @Serializable data class VerifyPending(val email: String? = null) : Route()

    @Keep @Serializable data object ForgotPassword : Route()

    @Keep @Serializable data object ResetPassword : Route()

    @Keep @Serializable data object Account : Route()

    @Keep @Serializable data object AccountDevices : Route()

    @Keep @Serializable data class AccountDeviceDetails(val id: String) : Route()

    @Keep
    @Serializable
    data object Lock : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data object License : Route()

    @Keep
    @Serializable
    data object Logs : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data object Appearance : Route()

    @Keep @Serializable data object Language : Route()

    @Keep @Serializable data object Display : Route()

    @Keep @Serializable data object Notifications : Route()

    @Keep
    @Serializable
    data object Tunnels : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data class TunnelSettings(val id: Int) : Route()

    @Keep
    @Serializable
    data class Config(val id: Int, val live: Boolean = false) : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data class IPv6(val id: Int) : Route()

    @Keep @Serializable data class EntryTunnel(val id: Int) : Route()

    @Keep
    @Serializable
    data class SplitTunnel(val id: Int) : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data class ConfigGlobal(val id: Int?) : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data class SplitTunnelGlobal(val id: Int) : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data object Settings : Route()

    @Keep
    @Serializable
    data object AndroidIntegrations : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data object Dns : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data object TunnelGlobals : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data object Advanced : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data object GlobalAmnezia : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep
    @Serializable
    data object ProxySettings : Route(), SecureRoute {
        override val requiresProtection: Boolean
            get() = true
    }

    @Keep @Serializable data object LockdownSettings : Route()

    @Keep @Serializable data object Security : Route()

    @Keep @Serializable data object Monitoring : Route()

    @Keep @Serializable data object TunnelRecovery : Route()

    @Keep @Serializable data object MonitoringAndRecovery : Route()
}

enum class Tab(
    val startRoute: Route,
    val titleRes: Int,
    val inactiveIcon: androidx.compose.ui.graphics.vector.ImageVector,
    val activeIcon: androidx.compose.ui.graphics.vector.ImageVector,
    val index: Int,
) {
    TUNNELS(Route.Tunnels, R.string.tunnels, Icons.Outlined.Home, Icons.Filled.Home, 0),
    ACCOUNT(Route.Account, R.string.account, Icons.Outlined.Person, Icons.Filled.Person, 1),
    SETTINGS(Route.Settings, R.string.settings, Icons.Outlined.Settings, Icons.Filled.Settings, 2),
    SUPPORT(
        Route.Support,
        R.string.support,
        Icons.Outlined.QuestionMark,
        Icons.Filled.QuestionMark,
        3,
    );

    companion object {
        fun fromRoute(route: Route): Tab =
            when (route) {
                is Route.Tunnels,
                is Route.TunnelSettings,
                is Route.Lock,
                is Route.Config,
                is Route.IPv6,
                is Route.EntryTunnel,
                is Route.SplitTunnel -> TUNNELS
                Route.Account,
                Route.AccountDevices,
                is Route.AccountDeviceDetails,
                Route.Onboarding,
                Route.Login,
                Route.Register,
                is Route.VerifyPending,
                Route.ForgotPassword,
                Route.ResetPassword -> ACCOUNT
                is Route.Settings,
                Route.AndroidIntegrations,
                Route.Dns,
                is Route.SplitTunnelGlobal,
                Route.ProxySettings,
                Route.LockdownSettings,
                Route.Appearance,
                Route.Language,
                Route.Display,
                Route.Notifications,
                is Route.ConfigGlobal,
                Route.TunnelGlobals,
                Route.Advanced,
                Route.GlobalAmnezia,
                Route.Security,
                Route.Monitoring,
                Route.TunnelRecovery,
                Route.MonitoringAndRecovery,
                Route.Logs -> SETTINGS
                is Route.Support,
                Route.License -> SUPPORT
            }
    }
}

interface SecureRoute {
    val requiresProtection: Boolean
}
