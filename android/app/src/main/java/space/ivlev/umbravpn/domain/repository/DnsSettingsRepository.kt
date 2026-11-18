package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.DnsSettings

interface DnsSettingsRepository {
    suspend fun upsert(dnsSettings: DnsSettings)

    val flow: Flow<DnsSettings>

    suspend fun getDnsSettings(): DnsSettings

    suspend fun updateGlobalDnsEnabled(enabled: Boolean)
}
