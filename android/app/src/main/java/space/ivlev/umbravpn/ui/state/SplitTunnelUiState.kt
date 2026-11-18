package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.model.InstalledPackage
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.state.SplitBehavior

data class SplitTunnelUiState(
    val installedPackages: List<InstalledPackage> = emptyList(),
    val isLoading: Boolean = true,
    val tunnel: TunnelConfig? = null,
    val tunnels: List<TunnelSummary> = emptyList(),
    val activeBehavior: SplitBehavior = SplitBehavior.ALL,
    val includedPackages: Set<String> = emptySet(),
    val excludedPackages: Set<String> = emptySet(),
    val selectedCopySourceTunnelId: Int? = null,
    // Set once. Later emissions must not replace the app sets.
    val initialized: Boolean = false,
    val needsRestart: Boolean = false,
    // Null on the global editor.
    val globalOverride: SplitAppListSummary? = null,
    // Null where strict split tunneling can't apply, like before Android 10 or outside VPN mode.
    val strictSplitEnabled: Boolean? = null,
)
