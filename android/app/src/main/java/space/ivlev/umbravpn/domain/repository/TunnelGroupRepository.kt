package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.TunnelGroup

interface TunnelGroupRepository {
    val flow: Flow<List<TunnelGroup>>

    suspend fun getAll(): List<TunnelGroup>

    suspend fun getById(id: Int): TunnelGroup?

    suspend fun save(group: TunnelGroup): Int

    suspend fun saveAll(groups: List<TunnelGroup>)

    suspend fun delete(group: TunnelGroup)

    suspend fun setExpanded(id: Int, expanded: Boolean)
}
