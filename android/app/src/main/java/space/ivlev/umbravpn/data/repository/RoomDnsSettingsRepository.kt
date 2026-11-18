package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.DnsSettingsDao
import space.ivlev.umbravpn.data.entity.DnsSettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.model.DnsSettings as Domain
import space.ivlev.umbravpn.domain.repository.DnsSettingsRepository

class RoomDnsSettingsRepository(private val dnsSettingsDao: DnsSettingsDao) :
    DnsSettingsRepository {
    override suspend fun upsert(dnsSettings: Domain) {
        dnsSettingsDao.upsert(dnsSettings.toEntity())
    }

    override val flow: Flow<Domain>
        get() = dnsSettingsDao.getDnsSettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getDnsSettings(): Domain {
        return (dnsSettingsDao.getDnsSettings() ?: Entity()).toDomain()
    }

    override suspend fun updateGlobalDnsEnabled(enabled: Boolean) {
        dnsSettingsDao.updateGlobalDnsEnabled(enabled)
    }
}
