package space.ivlev.umbravpn.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "managed_tunnel",
    indices = [Index(value = ["tunnel_id"], unique = true)],
)
data class ManagedTunnel(
    @PrimaryKey @ColumnInfo(name = "device_id") val deviceId: String,
    @ColumnInfo(name = "tunnel_id") val tunnelId: Int,
    @ColumnInfo(name = "device_name") val deviceName: String,
    @ColumnInfo(name = "interface_id") val interfaceId: String? = null,
    @ColumnInfo(name = "endpoint") val endpoint: String? = null,
    @ColumnInfo(name = "revision") val revision: String,
    @ColumnInfo(name = "synced_at") val syncedAt: Long,
)
