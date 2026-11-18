package space.ivlev.umbravpn.data.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.data.entity.ProxySettings

@Dao
interface ProxySettingsDao {
    @Upsert suspend fun upsert(proxySettings: ProxySettings)

    @Query("SELECT * FROM proxy_settings LIMIT 1") suspend fun getProxySettings(): ProxySettings?

    @Query("SELECT * FROM proxy_settings LIMIT 1") fun getProxySettingsFlow(): Flow<ProxySettings?>
}
