package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.ManagedTunnel as Entity
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel as Domain

fun Entity.toDomain(): Domain =
    Domain(
        deviceId = deviceId,
        tunnelId = tunnelId,
        deviceName = deviceName,
        interfaceId = interfaceId,
        endpoint = endpoint,
        revision = revision,
        syncedAt = syncedAt,
    )

fun Domain.toEntity(): Entity =
    Entity(
        deviceId = deviceId,
        tunnelId = tunnelId,
        deviceName = deviceName,
        interfaceId = interfaceId,
        endpoint = endpoint,
        revision = revision,
        syncedAt = syncedAt,
    )
