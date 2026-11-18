package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.model.LockdownSettings

data class LockdownSettingsUiState(
    val lockdownSettings: LockdownSettings = LockdownSettings(),
    val metered: Boolean = false,
    val dualStack: Boolean = false,
    val bypassLan: Boolean = false,
    val isLoading: Boolean = true,
    val showSaveModal: Boolean = false,
)
