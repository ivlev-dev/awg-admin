package space.ivlev.umbravpn.data.account

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class LoginRequestDto(
    val login: String,
    val password: String,
    @SerialName("totp_code") val totpCode: String? = null,
)

@Serializable
internal data class RegisterRequestDto(
    val email: String,
    val password: String,
)

@Serializable internal data class VerifyEmailRequestDto(val token: String)

@Serializable internal data class ResendVerificationRequestDto(val email: String)

@Serializable internal data class ForgotPasswordRequestDto(val email: String)

@Serializable internal data class ResetPasswordRequestDto(val token: String, val password: String)

@Serializable
internal data class RefreshRequestDto(@SerialName("refresh_token") val refreshToken: String)

@Serializable
internal data class LogoutRequestDto(@SerialName("refresh_token") val refreshToken: String)

@Serializable
internal data class CreateDeviceRequestDto(
    val name: String,
    @SerialName("interface_ids") val interfaceIds: List<String>? = null,
)

@Serializable internal data class RenameDeviceRequestDto(val name: String)

@Serializable
internal data class AuthResponseDto(
    val token: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
    val user: UserDto,
)

@Serializable
internal data class UserDto(
    val id: String,
    val login: String,
    val email: String = "",
    val status: String = "active",
    @SerialName("totp_enabled") val totpEnabled: Boolean = false,
    val role: String = "user",
    @SerialName("tariff_id") val tariffId: String? = null,
    @SerialName("group_id") val groupId: String? = null,
    @SerialName("node_id") val nodeId: String? = null,
    val disabled: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable internal data class StatusResponseDto(val status: String? = null)

@Serializable internal data class OkResponseDto(val ok: Boolean = true)

@Serializable
internal data class BootstrapDto(
    val user: UserDto,
    val tariff: TariffDto? = null,
    val quota: QuotaDto? = null,
    val devices: List<DeviceDto> = emptyList(),
    val interfaces: List<InterfaceDto> = emptyList(),
    val subscription: SubscriptionDto? = null,
    val access: AccessDto? = null,
)

@Serializable
internal data class InterfaceDto(
    val id: String,
    val name: String = "",
    @SerialName("node_id") val nodeId: String = "",
    @SerialName("node_name") val nodeName: String = "",
)

@Serializable
internal data class SubscriptionDto(
    val id: String = "",
    @SerialName("plan_name") val planName: String = "",
    val status: String = "",
    @SerialName("current_period_end") val currentPeriodEnd: String? = null,
    @SerialName("auto_renew") val autoRenew: Boolean = false,
    @SerialName("cancel_at_period_end") val cancelAtPeriodEnd: Boolean = false,
    @SerialName("grants_access") val grantsAccess: Boolean = false,
)

@Serializable
internal data class AccessDto(
    val blocked: Boolean = false,
    val throttled: Boolean = false,
    val reasons: List<String> = emptyList(),
)

@Serializable
internal data class TariffDto(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("max_devices") val maxDevices: Int = 0,
    @SerialName("device_down_kbps") val deviceDownKbps: Int = 0,
    @SerialName("device_up_kbps") val deviceUpKbps: Int = 0,
    @SerialName("traffic_quota_bytes") val trafficQuotaBytes: Long? = null,
)

@Serializable
internal data class QuotaDto(
    @SerialName("used_bytes") val usedBytes: Long = 0,
    @SerialName("quota_bytes") val quotaBytes: Long? = null,
    val exceeded: Boolean = false,
    @SerialName("remaining_bytes") val remainingBytes: Long? = null,
    val percent: Double? = null,
    @SerialName("period_start") val periodStart: String? = null,
    @SerialName("period_end") val periodEnd: String? = null,
    @SerialName("reset_at") val resetAt: String? = null,
)

@Serializable
internal data class DeviceDto(
    val id: String,
    @SerialName("user_id") val userId: String = "",
    @SerialName("group_id") val groupId: String? = null,
    @SerialName("interface_id") val interfaceId: String = "",
    @SerialName("interface_name") val interfaceName: String = "",
    @SerialName("node_id") val nodeId: String? = null,
    @SerialName("node_name") val nodeName: String = "",
    val name: String = "",
    @SerialName("down_kbps") val downKbps: Int = 0,
    @SerialName("up_kbps") val upKbps: Int = 0,
    val revoked: Boolean = false,
    val external: Boolean = false,
    val addresses: List<String> = emptyList(),
    val peers: List<DevicePeerDto> = emptyList(),
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
internal data class DevicePeerDto(
    @SerialName("interface_id") val interfaceId: String = "",
    @SerialName("interface_name") val interfaceName: String = "",
    @SerialName("public_key") val publicKey: String = "",
    val addresses: List<String> = emptyList(),
    @SerialName("peer_id") val peerId: String = "",
    val label: String = "",
)

@Serializable
internal data class DeviceConfigDto(
    @SerialName("interface_id") val interfaceId: String = "",
    @SerialName("interface_name") val interfaceName: String = "",
    @SerialName("node_id") val nodeId: String = "",
    val endpoint: String = "",
    val addresses: List<String> = emptyList(),
    val conf: String = "",
    val revision: String = "",
    @SerialName("peer_id") val peerId: String = "",
    val label: String = "",
)

@Serializable
internal data class CreateTunnelRequestDto(
    @SerialName("interface_id") val interfaceId: String,
    val label: String? = null,
)

@Serializable
internal data class AppDeviceDto(
    val device: DeviceDto,
    val config: DeviceConfigDto,
    val configs: List<DeviceConfigDto> = emptyList(),
)
