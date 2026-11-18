package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.AutoTunnelSettings as Entity
import space.ivlev.umbravpn.domain.model.AutoTunnelSettings as Domain

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        isAutoTunnelEnabled = isAutoTunnelEnabled,
        isTunnelOnMobileDataEnabled = isTunnelOnMobileDataEnabled,
        trustedNetworkSSIDs = trustedNetworkSSIDs,
        isTunnelOnEthernetEnabled = isTunnelOnEthernetEnabled,
        isTunnelOnWifiEnabled = isTunnelOnWifiEnabled,
        isWildcardsEnabled = isWildcardsEnabled,
        isStopOnNoInternetEnabled = isStopOnNoInternetEnabled,
        isTunnelOnUnsecureEnabled = isTunnelOnUnsecureEnabled,
        wifiDetectionMethod = wifiDetectionMethod,
        startOnBoot = startOnBoot,
        disableTunnelOnCaptivePortal = disableTunnelOnCaptivePortal,
        trustedNetworkBSSIDs = trustedNetworkBSSIDs,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        isAutoTunnelEnabled = isAutoTunnelEnabled,
        isTunnelOnMobileDataEnabled = isTunnelOnMobileDataEnabled,
        trustedNetworkSSIDs = trustedNetworkSSIDs,
        isTunnelOnEthernetEnabled = isTunnelOnEthernetEnabled,
        isTunnelOnWifiEnabled = isTunnelOnWifiEnabled,
        isWildcardsEnabled = isWildcardsEnabled,
        isStopOnNoInternetEnabled = isStopOnNoInternetEnabled,
        isTunnelOnUnsecureEnabled = isTunnelOnUnsecureEnabled,
        wifiDetectionMethod = wifiDetectionMethod,
        startOnBoot = startOnBoot,
        disableTunnelOnCaptivePortal = disableTunnelOnCaptivePortal,
        trustedNetworkBSSIDs = trustedNetworkBSSIDs,
    )
