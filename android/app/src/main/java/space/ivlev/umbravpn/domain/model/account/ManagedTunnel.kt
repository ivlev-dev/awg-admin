package space.ivlev.umbravpn.domain.model.account

import androidx.compose.runtime.Immutable

@Immutable
data class ManagedTunnel(
    val deviceId: String,
    val tunnelId: Int,
    val deviceName: String,
    val interfaceId: String,
    val endpoint: String?,
    val revision: String,
    val syncedAt: Long,
    val peerId: String = "",
    val label: String = "",
)
