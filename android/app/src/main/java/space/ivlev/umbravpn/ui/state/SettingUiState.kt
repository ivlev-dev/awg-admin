package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.model.GeneralSettings
import space.ivlev.umbravpn.domain.model.MonitoringSettings
import space.ivlev.umbravpn.domain.model.TunnelConfig

data class SettingUiState(
    val settings: GeneralSettings = GeneralSettings(),
    val isLocalLoggingEnabled: Boolean = false,
    val remoteKey: String? = null,
    val isRemoteEnabled: Boolean = false,
    val isPinLockEnabled: Boolean = false,
    val showDetailedPingStats: Boolean = false,
    val isLoading: Boolean = true,
    val globalTunnelConfig: TunnelConfig? = null,
    val tunnels: List<TunnelConfig> = emptyList(),
    val monitoring: MonitoringSettings = MonitoringSettings(),
    val tunnelActive: Boolean = false,
    val recoveryEventCount: Int = 0,
    val lastRecoveryEventMs: Long = 0L,
)
