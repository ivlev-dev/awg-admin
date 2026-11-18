package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.AppState as Entity
import space.ivlev.umbravpn.domain.model.AppState as Domain

fun Entity.toDomain(): Domain =
    Domain(
        isLocationDisclosureShown = isLocationDisclosureShown,
        isBatteryOptimizationDisableShown = isBatteryOptimizationDisableShown,
        isNotificationPermissionRequested = isNotificationPermissionRequested,
        shouldShowDonationSnackbar = shouldShowDonationSnackbar,
        isDesktopPromptShown = isDesktopPromptShown,
    )
