package space.ivlev.umbravpn.domain.model

import space.ivlev.umbravpn.domain.enums.BootstrapDnsProtocol
import space.ivlev.umbravpn.domain.enums.ForeignDnsPolicy
import space.ivlev.umbravpn.domain.enums.SplitDnsSuffixTarget
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.domain.enums.TunnelDnsProtocol

data class DnsSettings(
    val id: Int = 0,
    val bootstrapDnsProtocol: BootstrapDnsProtocol = BootstrapDnsProtocol.fromValue(0),
    val bootstrapDnsEndpoint: String? = null,
    val isGlobalTunnelConfigDnsEnabled: Boolean = false,
    val tunnelDnsMode: TunnelDnsMode = TunnelDnsMode.Off,
    val tunnelDnsProtocol: TunnelDnsProtocol = TunnelDnsProtocol.Doh,
    val tunnelDnsEndpoint: String? = null,
    val useTunnelDnsServersInSplit: Boolean = true,
    val localSuffixes: String? = null,
    val foreignDnsPolicy: ForeignDnsPolicy = ForeignDnsPolicy.Redirect,
    val splitSuffixTarget: SplitDnsSuffixTarget = SplitDnsSuffixTarget.System,
)
