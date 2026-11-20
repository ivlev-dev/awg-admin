package space.ivlev.umbravpn.data.admin

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class AdminAuditEntryDto(
    val id: String,
    val at: String? = null,
    @SerialName("actor_id") val actorId: String? = null,
    @SerialName("actor_email") val actorEmail: String = "",
    @SerialName("actor_login") val actorLogin: String = "",
    val action: String = "",
    val entity: String = "",
    @SerialName("entity_id") val entityId: String? = null,
    val status: Int = 0,
    val ip: String? = null,
    val details: String? = null,
)

@Serializable
internal data class AdminAuditPageDto(
    val items: List<AdminAuditEntryDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

@Serializable internal data class AdminTrafficTotalsDto(val rx: Long = 0, val tx: Long = 0)

@Serializable
internal data class AdminTopDeviceDto(
    @SerialName("device_id") val deviceId: String,
    val name: String = "",
    @SerialName("user_id") val userId: String = "",
    val rx: Long = 0,
    val tx: Long = 0,
    val online: Boolean = false,
)

@Serializable
internal data class AdminSeriesPointDto(
    val at: String? = null,
    val rx: Long = 0,
    val tx: Long = 0,
    @SerialName("rx_bps") val rxBps: Double = 0.0,
    @SerialName("tx_bps") val txBps: Double = 0.0,
)

@Serializable
internal data class AdminStatsPointDto(val at: String? = null, val rx: Long = 0, val tx: Long = 0)

@Serializable
internal data class AdminAggregateDto(
    val bucket: String = "day",
    val points: List<AdminStatsPointDto> = emptyList(),
)

@Serializable
internal data class AdminQuotaUserDto(
    @SerialName("user_id") val userId: String,
    val email: String = "",
    @SerialName("used_bytes") val usedBytes: Long = 0,
    @SerialName("quota_bytes") val quotaBytes: Long? = null,
    val exceeded: Boolean = false,
    val percent: Double? = null,
)

@Serializable
internal data class AdminObfuscationDto(
    val profile: String = "http3",
    val intensity: String = "high",
    val browser: String = "chrome",
    val mtu: Int = 1420,
    @SerialName("jc_min") val jcMin: Int = 8,
    @SerialName("jc_max") val jcMax: Int = 12,
    @SerialName("jmin_min") val jminMin: Int = 40,
    @SerialName("jmin_max") val jminMax: Int = 80,
    @SerialName("jmax_extra_min") val jmaxExtraMin: Int = 60,
    @SerialName("jmax_extra_max") val jmaxExtraMax: Int = 180,
    @SerialName("s_min") val sMin: Int = 12,
    @SerialName("s_max") val sMax: Int = 128,
    val hosts: List<String> = emptyList(),
    @SerialName("random_trailers") val randomTrailers: Boolean = true,
    @SerialName("disable_cookies") val disableCookies: Boolean = false,
    @SerialName("keepalive_min") val keepaliveMin: Int = 15,
    @SerialName("keepalive_max") val keepaliveMax: Int = 25,
)

@Serializable
internal data class AdminSettingsDto(
    val obfuscation: AdminObfuscationDto = AdminObfuscationDto(),
    @SerialName("share_default_ttl_secs") val shareDefaultTtlSecs: Long = 86_400,
    @SerialName("stats_retention_days") val statsRetentionDays: Int = 90,
)
