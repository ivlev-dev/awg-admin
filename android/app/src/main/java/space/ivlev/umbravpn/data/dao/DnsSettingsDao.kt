package space.ivlev.umbravpn.data.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.data.entity.DnsSettings

@Dao
interface DnsSettingsDao {
    @Query("SELECT * FROM dns_settings LIMIT 1") suspend fun getDnsSettings(): DnsSettings?

    @Upsert suspend fun upsert(dnsSettings: DnsSettings)

    @Query("SELECT * FROM dns_settings LIMIT 1") fun getDnsSettingsFlow(): Flow<DnsSettings?>

    @Query("UPDATE dns_settings SET global_tunnel_config_dns_enabled = :enabled")
    suspend fun updateGlobalDnsEnabled(enabled: Boolean)
}
