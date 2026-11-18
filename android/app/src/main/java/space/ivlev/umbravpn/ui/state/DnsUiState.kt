package space.ivlev.umbravpn.ui.state

import com.wgtunnel.backend.model.dns.DnsValidationError
import com.zaneschepke.networkmonitor.DnsInfo
import space.ivlev.umbravpn.domain.model.DnsSettings
import space.ivlev.umbravpn.domain.model.TunnelConfig

data class DnsUiState(
    val dnsSettings: DnsSettings = DnsSettings(),
    val isLoading: Boolean = true,
    val globalTunnelConfig: TunnelConfig? = null,
    val globalDnsServers: String = "",
    val bootstrapEndpointError: DnsValidationError? = null,
    val tunnelEndpointError: DnsValidationError? = null,
    val localSuffixesError: DnsValidationError? = null,
    val systemDnsInfo: DnsInfo? = null,
    val hasActiveTunnel: Boolean = false,
    val savedDnsSettings: DnsSettings = DnsSettings(),
    val savedGlobalDnsServers: String = "",
) {
    val isDirty: Boolean
        get() =
            dnsSettings != savedDnsSettings ||
                globalDnsServers.trim() != savedGlobalDnsServers.trim()
}
