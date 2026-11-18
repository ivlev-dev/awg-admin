package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.ui.theme.Theme

data class GlobalAppUiState(
    val isAppLoaded: Boolean = false,
    val theme: Theme = Theme.AUTOMATIC,
    val pinLockEnabled: Boolean = false,
    val tunnelMode: TunnelMode = TunnelMode.VPN,
    val shouldShowDonationSnackbar: Boolean = false,
    val isDesktopPromptShown: Boolean = false,
    val isBatteryOptimizationShown: Boolean = false,
    val tunnelNames: Map<Int, String> = emptyMap(),
    val selectedTunnelCount: Int = 0,
    val canMoveToGroup: Boolean = false,
    val isReorderMode: Boolean = false,
    val reorderScopeTitle: String? = null,
    val hasGroups: Boolean = false,
    val canReorder: Boolean = false,
    val hasActiveTunnel: Boolean = false,
    val alreadyDonated: Boolean = false,
    val isPinVerified: Boolean = false,
    val pendingWgImportUrl: String? = null,
    val isScreenRecordingProtectionEnabled: Boolean = false,
)
