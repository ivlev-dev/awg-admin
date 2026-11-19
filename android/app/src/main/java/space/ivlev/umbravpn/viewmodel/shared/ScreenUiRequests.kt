package space.ivlev.umbravpn.viewmodel.shared

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

internal class ScreenUiRequests {
    private val _screenDirty = MutableStateFlow(false)
    val screenDirty: StateFlow<Boolean> = _screenDirty.asStateFlow()

    fun setScreenDirty(dirty: Boolean) {
        _screenDirty.value = dirty
    }

    private val _supportAutoUpdateRequests = MutableSharedFlow<Boolean>(extraBufferCapacity = 1)
    val supportAutoUpdateRequests = _supportAutoUpdateRequests.asSharedFlow()

    fun requestSupportAutoUpdate(startDownload: Boolean) {
        _supportAutoUpdateRequests.tryEmit(startDownload)
    }

    // Sticky, the Support screen may not be composed yet when this is requested
    private val _showUpdateStatusRequested = MutableStateFlow(false)
    val showUpdateStatusRequested = _showUpdateStatusRequested.asStateFlow()

    fun requestShowUpdateStatus() {
        _showUpdateStatusRequested.value = true
    }

    fun consumeShowUpdateStatus() {
        _showUpdateStatusRequested.value = false
    }

    private val _showSplitSystemApps = MutableStateFlow(false)
    val showSplitSystemApps = _showSplitSystemApps.asStateFlow()
    private var splitSystemAppsTunnelId: Int? = null

    fun prepareSplitSystemApps(tunnelId: Int) {
        if (splitSystemAppsTunnelId != tunnelId) {
            splitSystemAppsTunnelId = tunnelId
            _showSplitSystemApps.value = false
        }
    }

    fun setShowSplitSystemApps(show: Boolean) {
        _showSplitSystemApps.value = show
    }

    fun clearSplitSystemApps(tunnelId: Int) {
        if (splitSystemAppsTunnelId == tunnelId) {
            splitSystemAppsTunnelId = null
            _showSplitSystemApps.value = false
        }
    }
}
