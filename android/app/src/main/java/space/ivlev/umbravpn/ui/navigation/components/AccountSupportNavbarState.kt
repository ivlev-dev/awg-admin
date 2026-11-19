package space.ivlev.umbravpn.ui.navigation.components

import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Route.AccessBlocked
import space.ivlev.umbravpn.ui.navigation.Route.Account
import space.ivlev.umbravpn.ui.navigation.Route.AccountDeviceDetails
import space.ivlev.umbravpn.ui.navigation.Route.AccountDevices
import space.ivlev.umbravpn.ui.navigation.Route.AndroidIntegrations
import space.ivlev.umbravpn.ui.navigation.Route.ForgotPassword
import space.ivlev.umbravpn.ui.navigation.Route.Login
import space.ivlev.umbravpn.ui.navigation.Route.Onboarding
import space.ivlev.umbravpn.ui.navigation.Route.Register
import space.ivlev.umbravpn.ui.navigation.Route.ResetPassword
import space.ivlev.umbravpn.ui.navigation.Route.SessionExpired
import space.ivlev.umbravpn.ui.navigation.Route.Support
import space.ivlev.umbravpn.ui.navigation.Route.VerifyPending
import space.ivlev.umbravpn.ui.state.NavbarState

internal fun accountSupportNavbarState(context: NavbarContext, route: Route?): NavbarState? =
    when (route) {
        Support ->
            NavbarState(
                topTitle = context.title(R.string.support),
                showBottomItems = true,
            )
        AndroidIntegrations -> context.backTitleState(R.string.android_integrations)
        Onboarding,
        AccessBlocked,
        SessionExpired -> NavbarState(showBottomItems = false)
        Login -> context.backTitleState(R.string.account_login_title, showBottomItems = false)
        Register -> context.backTitleState(R.string.account_register_title, showBottomItems = false)
        is VerifyPending ->
            context.backTitleState(R.string.account_verify_title, showBottomItems = false)
        ForgotPassword ->
            context.backTitleState(R.string.account_forgot_title, showBottomItems = false)
        ResetPassword ->
            context.backTitleState(R.string.account_reset_title, showBottomItems = false)
        Account -> NavbarState(showBottomItems = true)
        AccountDevices -> context.backTitleState(R.string.account_devices_title)
        is AccountDeviceDetails -> context.backTitleState(R.string.account_device_details)
        else -> null
    }
