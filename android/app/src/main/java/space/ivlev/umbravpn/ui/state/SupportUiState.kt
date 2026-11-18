package space.ivlev.umbravpn.ui.state

import space.ivlev.umbravpn.domain.model.AppUpdate
import space.ivlev.umbravpn.domain.model.UpdateDownloadState

data class SupportUiState(
    val appUpdate: AppUpdate? = null,
    val isLoading: Boolean = false,
    val download: UpdateDownloadState = UpdateDownloadState.Idle,
)
