package space.ivlev.umbravpn.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "managed_tunnel",
    primaryKeys = ["device_id", "interface_id", "peer_id"],
    indices = [Index(value = ["tunnel_id"], unique = true)],
)
data class ManagedTunnel(
    @ColumnInfo(name = "device_id") val deviceId: String,
    @ColumnInfo(name = "tunnel_id") val tunnelId: Int,
    @ColumnInfo(name = "device_name") val deviceName: String,
    @ColumnInfo(name = "interface_id") val interfaceId: String,
    @ColumnInfo(name = "endpoint") val endpoint: String? = null,
    @ColumnInfo(name = "revision") val revision: String,
    @ColumnInfo(name = "synced_at") val syncedAt: Long,
    @ColumnInfo(name = "peer_id") val peerId: String = "",
    @ColumnInfo(name = "label") val label: String = "",
)
