package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.ProxySettings

interface ProxySettingsRepository {
    suspend fun upsert(proxySettings: ProxySettings)

    val flow: Flow<ProxySettings>

    suspend fun getProxySettings(): ProxySettings
}
