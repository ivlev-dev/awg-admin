package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.ProxySettingsDao
import space.ivlev.umbravpn.data.entity.ProxySettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.ProxySettings as Domain
import space.ivlev.umbravpn.domain.repository.ProxySettingsRepository

class RoomProxySettingsRepository(private val proxySettingsDao: ProxySettingsDao) :
    ProxySettingsRepository {

    override suspend fun upsert(proxySettings: Domain) {
        proxySettingsDao.upsert(proxySettings.toEntity())
    }

    override val flow = proxySettingsDao.getProxySettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getProxySettings(): Domain {
        return (proxySettingsDao.getProxySettings() ?: Entity()).toDomain()
    }
}
