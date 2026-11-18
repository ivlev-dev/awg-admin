package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.ProxySettings as Entity
import space.ivlev.umbravpn.domain.model.ProxySettings as Domain

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        socks5ProxyEnabled = socks5ProxyEnabled,
        socks5ProxyBindAddress = socks5ProxyBindAddress,
        httpProxyEnabled = httpProxyEnabled,
        httpProxyBindAddress = httpProxyBindAddress,
        proxyUsername = proxyUsername,
        proxyPassword = proxyPassword,
        allowSocks4 = allowSocks4,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        socks5ProxyEnabled = socks5ProxyEnabled,
        socks5ProxyBindAddress = socks5ProxyBindAddress,
        httpProxyEnabled = httpProxyEnabled,
        httpProxyBindAddress = httpProxyBindAddress,
        proxyUsername = proxyUsername,
        proxyPassword = proxyPassword,
        allowSocks4 = allowSocks4,
    )
