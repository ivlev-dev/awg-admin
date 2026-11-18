package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.DnsSettings as Entity
import space.ivlev.umbravpn.domain.model.DnsSettings as Domain

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        bootstrapDnsProtocol = bootstrapDnsProtocol,
        bootstrapDnsEndpoint = bootstrapDnsEndpoint,
        isGlobalTunnelConfigDnsEnabled = isGlobalTunnelConfigDnsEnabled,
        tunnelDnsMode = tunnelDnsMode,
        tunnelDnsProtocol = tunnelDnsProtocol,
        tunnelDnsEndpoint = tunnelDnsEndpoint,
        useTunnelDnsServersInSplit = useTunnelDnsServersInSplit,
        localSuffixes = localSuffixes,
        foreignDnsPolicy = foreignDnsPolicy,
        splitSuffixTarget = splitSuffixTarget,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        bootstrapDnsProtocol = bootstrapDnsProtocol,
        bootstrapDnsEndpoint = bootstrapDnsEndpoint,
        isGlobalTunnelConfigDnsEnabled = isGlobalTunnelConfigDnsEnabled,
        tunnelDnsMode = tunnelDnsMode,
        tunnelDnsProtocol = tunnelDnsProtocol,
        useTunnelDnsServersInSplit = useTunnelDnsServersInSplit,
        tunnelDnsEndpoint = tunnelDnsEndpoint,
        localSuffixes = localSuffixes,
        foreignDnsPolicy = foreignDnsPolicy,
        splitSuffixTarget = splitSuffixTarget,
    )
