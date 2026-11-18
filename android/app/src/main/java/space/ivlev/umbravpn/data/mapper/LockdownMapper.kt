package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.LockdownSettings as Entity
import space.ivlev.umbravpn.domain.model.LockdownSettings as Domain

fun Entity.toDomain(): Domain =
    Domain(id = id, bypassLan = bypassLan, metered = metered, dualStack = dualStack)

fun Domain.toEntity(): Entity =
    Entity(id = id, bypassLan = bypassLan, metered = metered, dualStack = dualStack)
