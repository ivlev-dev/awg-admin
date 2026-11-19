@file:UseSerializers(InstantIsoSerializer::class)

package space.ivlev.umbravpn.domain.model.account

import androidx.compose.runtime.Immutable
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

@Serializable
@Immutable
data class AccountSnapshot(
    val user: AuthUser,
    val tariff: AccountTariff?,
    val quota: AccountQuota,
    val devices: List<AccountDevice>,
    val interfaces: List<AccountInterface> = emptyList(),
    val subscription: AccountSubscription? = null,
    val access: AccountAccess = AccountAccess(),
)

@Serializable
@Immutable
data class AccountInterface(
    val id: String,
    val name: String,
    val nodeId: String = "",
    val nodeName: String = "",
)

@Serializable
@Immutable
data class AccountTariff(
    val id: String,
    val name: String,
    val description: String,
    val maxDevices: Int,
    val deviceDownKbps: Int,
    val deviceUpKbps: Int,
    val trafficQuotaBytes: Long?,
)

@Serializable
@Immutable
data class AccountQuota(
    val usedBytes: Long,
    val quotaBytes: Long?,
    val exceeded: Boolean,
    val remainingBytes: Long?,
    val percent: Double?,
    val periodStart: Instant?,
    val periodEnd: Instant?,
    val resetAt: Instant?,
)

@Serializable
@Immutable
data class AccountDevice(
    val id: String,
    val userId: String,
    val groupId: String?,
    val interfaceId: String,
    val interfaceName: String,
    val nodeId: String?,
    val nodeName: String,
    val name: String,
    val downKbps: Int,
    val upKbps: Int,
    val revoked: Boolean,
    val external: Boolean,
    val addresses: List<String>,
    val peers: List<DevicePeer> = emptyList(),
    val createdAt: Instant?,
)

@Serializable
@Immutable
data class DevicePeer(
    val interfaceId: String,
    val interfaceName: String,
    val publicKey: String = "",
    val addresses: List<String> = emptyList(),
    val peerId: String = "",
    val label: String = "",
)

@Serializable
@Immutable
data class DeviceConfig(
    val interfaceId: String,
    val interfaceName: String,
    val nodeId: String,
    val endpoint: String,
    val addresses: List<String>,
    val conf: String,
    val revision: String,
    val peerId: String = "",
    val label: String = "",
)

@Serializable
@Immutable
data class CreatedDevice(
    val device: AccountDevice,
    val config: DeviceConfig,
    val configs: List<DeviceConfig> = listOf(config),
) {
    val allConfigs: List<DeviceConfig>
        get() = configs.ifEmpty { listOf(config) }
}
