package space.ivlev.umbravpn.ui.state

import com.wgtunnel.backend.state.BackendStatus
import space.ivlev.umbravpn.domain.model.ProxySettings

data class ProxySettingsUiState(
    val proxySettings: ProxySettings = ProxySettings(),

    // edit fields
    val socks5Enabled: Boolean = false,
    val httpEnabled: Boolean = false,
    val allowSocks4: Boolean = false,
    val socksBindAddress: String = "",
    val httpBindAddress: String = "",
    val proxyUsername: String = "",
    val proxyPassword: String = "",
    val passwordVisible: Boolean = false,
    val backendStatus: BackendStatus = BackendStatus(),
    val isSocks5BindAddressError: Boolean = false,
    val isHttpBindAddressError: Boolean = false,
    val isUserNameError: Boolean = false,
    val isPasswordError: Boolean = false,
    val isLoading: Boolean = true,
) {
    val isDirty: Boolean
        get() =
            socks5Enabled != proxySettings.socks5ProxyEnabled ||
                httpEnabled != proxySettings.httpProxyEnabled ||
                allowSocks4 != proxySettings.allowSocks4 ||
                socksBindAddress != (proxySettings.socks5ProxyBindAddress ?: "") ||
                httpBindAddress != (proxySettings.httpProxyBindAddress ?: "") ||
                proxyUsername != (proxySettings.proxyUsername ?: "") ||
                proxyPassword != (proxySettings.proxyPassword ?: "")
}
