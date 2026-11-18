package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.TunnelGroup as Entity
import space.ivlev.umbravpn.domain.model.TunnelGroup as Domain

fun Entity.toDomain(): Domain =
    Domain(id = id, name = name, position = position, expanded = expanded)

fun Domain.toEntity(): Entity =
    Entity(id = id, name = name, position = position, expanded = expanded)
