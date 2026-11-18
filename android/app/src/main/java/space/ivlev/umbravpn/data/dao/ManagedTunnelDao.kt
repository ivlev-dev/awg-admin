package space.ivlev.umbravpn.data.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.data.entity.ManagedTunnel

@Dao
interface ManagedTunnelDao {

    @Query("SELECT * FROM managed_tunnel ORDER BY device_name COLLATE NOCASE ASC")
    fun getAllFlow(): Flow<List<ManagedTunnel>>

    @Query("SELECT * FROM managed_tunnel ORDER BY device_name COLLATE NOCASE ASC")
    suspend fun getAll(): List<ManagedTunnel>

    @Query("SELECT * FROM managed_tunnel WHERE device_id = :deviceId LIMIT 1")
    suspend fun getByDeviceId(deviceId: String): ManagedTunnel?

    @Query("SELECT * FROM managed_tunnel WHERE tunnel_id = :tunnelId LIMIT 1")
    suspend fun getByTunnelId(tunnelId: Int): ManagedTunnel?

    @Upsert suspend fun upsert(binding: ManagedTunnel)

    @Query("DELETE FROM managed_tunnel WHERE device_id = :deviceId")
    suspend fun deleteByDeviceId(deviceId: String)

    @Query("DELETE FROM managed_tunnel WHERE tunnel_id = :tunnelId")
    suspend fun deleteByTunnelId(tunnelId: Int)
}
