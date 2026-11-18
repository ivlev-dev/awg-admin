package space.ivlev.umbravpn.domain.model.account

import java.time.Instant

data class AccountSnapshot(
    val user: AuthUser,
    val tariff: AccountTariff?,
    val quota: AccountQuota,
    val devices: List<AccountDevice>,
)

data class AccountTariff(
    val id: String,
    val name: String,
    val description: String,
    val maxDevices: Int,
    val deviceDownKbps: Int,
    val deviceUpKbps: Int,
    val trafficQuotaBytes: Long?,
)

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
    val createdAt: Instant?,
)

data class DeviceConfig(
    val interfaceId: String,
    val interfaceName: String,
    val nodeId: String,
    val endpoint: String,
    val addresses: List<String>,
    val conf: String,
    val revision: String,
)

data class CreatedDevice(val device: AccountDevice, val config: DeviceConfig)
