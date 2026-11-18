package space.ivlev.umbravpn.core.orchestration

import com.wgtunnel.backend.Backend
import com.wgtunnel.backend.model.dns.DnsBoostrapConfig
import com.wgtunnel.backend.model.dns.DnsBoostrapMode
import space.ivlev.umbravpn.domain.enums.BootstrapDnsProtocol
import space.ivlev.umbravpn.domain.model.DnsSettings

class DnsSettingsCoordinator(private val backend: Backend) {

    suspend fun appyDnsSettings(dnsSettings: DnsSettings) {
        val mode =
            when (dnsSettings.bootstrapDnsProtocol) {
                BootstrapDnsProtocol.SYSTEM -> DnsBoostrapMode.System
                BootstrapDnsProtocol.DOH ->
                    DnsBoostrapMode.Custom(DnsBoostrapConfig.DoH(dnsSettings.bootstrapDnsEndpoint))
                BootstrapDnsProtocol.DOT ->
                    DnsBoostrapMode.Custom(DnsBoostrapConfig.DoT(dnsSettings.bootstrapDnsEndpoint))
                BootstrapDnsProtocol.UDP ->
                    DnsBoostrapMode.Custom(
                        DnsBoostrapConfig.Plain(dnsSettings.bootstrapDnsEndpoint),
                    )
            }

        backend.setBootstrapDnsMode(mode)
    }
}
