package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.SessionState

sealed interface AccountDialog {
    data object AddDevice : AccountDialog

    data class RenameDevice(val id: String, val currentName: String) : AccountDialog

    data class DeleteDevice(val id: String, val name: String) : AccountDialog

    data class AddTunnel(val deviceId: String) : AccountDialog

    data class RenameTunnel(
        val deviceId: String,
        val peerId: String,
        val currentLabel: String,
    ) : AccountDialog

    data class DeleteTunnel(
        val deviceId: String,
        val peerId: String,
        val label: String,
    ) : AccountDialog

    data object Logout : AccountDialog

    data object ChangeServer : AccountDialog
}

sealed interface AccountSideEffect {
    data object SignedOut : AccountSideEffect

    data class Notice(val message: AccountMessage, val isError: Boolean = false) : AccountSideEffect
}

@Immutable
data class AccountUiState(
    val session: SessionState = SessionState.Unknown,
    val serverUrl: String = "",
    val snapshot: AccountSnapshot? = null,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: AccountMessage? = null,
    val dialog: AccountDialog? = null,
    val dialogError: AccountMessage? = null,
    val isActionInProgress: Boolean = false,
    val deviceEndpoint: String? = null,
    val isEndpointLoading: Boolean = false,
    val endpointError: AccountMessage? = null,
    val pendingCreateKey: String? = null,
    val pendingTunnelKey: String? = null,
) {
    val isActive: Boolean
        get() = session is SessionState.Active

    val devices: List<AccountDevice>
        get() = snapshot?.devices.orEmpty()
}
