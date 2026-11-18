package space.ivlev.umbravpn.data.entity

data class AppState(
    val isLocationDisclosureShown: Boolean = false,
    val isBatteryOptimizationDisableShown: Boolean = false,
    val isNotificationPermissionRequested: Boolean = false,
    val shouldShowDonationSnackbar: Boolean = false,
    val isDesktopPromptShown: Boolean = false,
)
