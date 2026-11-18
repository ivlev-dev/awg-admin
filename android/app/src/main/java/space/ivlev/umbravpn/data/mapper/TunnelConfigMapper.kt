package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.TunnelConfig as Entity
import space.ivlev.umbravpn.domain.model.TunnelConfig as Domain

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        name = name,
        tunnelNetworks = tunnelNetworks,
        isMobileDataTunnel = isMobileDataTunnel,
        isPrimaryTunnel = isPrimaryTunnel,
        quickConfig = quickConfig,
        isEthernetTunnel = isEthernetTunnel,
        isIpv6Preferred = isIpv6Preferred,
        position = position,
        autoTunnelApps = autoTunnelApps,
        isMetered = isMetered,
        ipv6RestoreEnabled = ipv6RestoreEnabled,
        tunnelBSSIDs = tunnelBSSIDs,
        isDDNSTunnel = isDDNSTunnel,
        groupId = groupId,
        entryTunnelId = entryTunnelId,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        name = name,
        tunnelNetworks = tunnelNetworks,
        isMobileDataTunnel = isMobileDataTunnel,
        isPrimaryTunnel = isPrimaryTunnel,
        quickConfig = quickConfig,
        isEthernetTunnel = isEthernetTunnel,
        isIpv6Preferred = isIpv6Preferred,
        position = position,
        autoTunnelApps = autoTunnelApps,
        isMetered = isMetered,
        ipv6RestoreEnabled = ipv6RestoreEnabled,
        tunnelBSSIDs = tunnelBSSIDs,
        isDDNSTunnel = isDDNSTunnel,
        groupId = groupId,
        entryTunnelId = entryTunnelId,
    )
