package space.ivlev.umbravpn.domain.model.admin

import androidx.compose.runtime.Immutable
import java.time.Instant
import space.ivlev.umbravpn.domain.admin.AdminMessage

@Immutable
data class AdminAuditEntry(
    val id: String,
    val at: Instant? = null,
    val actorId: String? = null,
    val actorEmail: String = "",
    val actorLogin: String = "",
    val action: String = "",
    val entity: String = "",
    val entityId: String? = null,
    val status: Int = 0,
    val ip: String? = null,
    val details: String? = null,
) {
    val displayActor: String
        get() = actorEmail.ifBlank { actorLogin }.ifBlank { UNKNOWN_ACTOR }

    val succeeded: Boolean
        get() = status in SUCCESS_MIN..SUCCESS_MAX

    companion object {
        private const val UNKNOWN_ACTOR = "system"
        private const val SUCCESS_MIN = 200
        private const val SUCCESS_MAX = 299
    }
}

@Immutable
data class AdminAuditPage(
    val items: List<AdminAuditEntry> = emptyList(),
    val nextCursor: String? = null,
)

enum class AdminAuditPeriod(val windowSeconds: Long?) {
    All(null),
    Day24(86_400),
    Week7(7 * 86_400L),
    Month30(30 * 86_400L),
}

@Immutable
data class AdminAuditQuery(
    val limit: Int = DEFAULT_LIMIT,
    val before: String? = null,
    val actor: String = "",
    val action: String = "",
    val entity: String = "",
    val from: Instant? = null,
    val to: Instant? = null,
) {
    val hasFilters: Boolean
        get() = actor.isNotBlank() || action.isNotBlank() || entity.isNotBlank()

    companion object {
        const val DEFAULT_LIMIT = 50
    }
}

@Immutable
data class AdminAuditField(val name: String, val value: String, val redacted: Boolean = false)

@Immutable
data class AdminTrafficTotals(val rx: Long = 0, val tx: Long = 0) {
    val total: Long
        get() = rx + tx
}

@Immutable data class AdminTrafficPoint(val at: Instant? = null, val rx: Long = 0, val tx: Long = 0)

enum class AdminStatsPeriod(val apiValue: String, val windowSeconds: Long) {
    Day24("24h", 86_400L),
    Week7("7d", 7 * 86_400L),
    Month30("30d", 30 * 86_400L),
}

@Immutable
data class AdminStatsQuery(
    val period: AdminStatsPeriod,
    val from: Instant,
    val to: Instant,
)

@Immutable
data class AdminQuotaUser(
    val userId: String,
    val email: String,
    val usedBytes: Long = 0,
    val quotaBytes: Long? = null,
    val exceeded: Boolean = false,
    val percent: Double? = null,
)

@Immutable
data class AdminTopDevice(
    val deviceId: String,
    val name: String,
    val userId: String,
    val rx: Long = 0,
    val tx: Long = 0,
    val online: Boolean = false,
) {
    val total: Long
        get() = rx + tx
}

enum class AdminObfuscationProfile(val apiValue: String) {
    Http3("http3"),
    Tls("tls"),
    Quic("quic"),
    Random("random");

    companion object {
        fun fromApi(value: String): AdminObfuscationProfile =
            entries.firstOrNull { it.apiValue == value } ?: Http3
    }
}

enum class AdminObfuscationIntensity(val apiValue: String) {
    Low("low"),
    Medium("medium"),
    High("high");

    companion object {
        fun fromApi(value: String): AdminObfuscationIntensity =
            entries.firstOrNull { it.apiValue == value } ?: High
    }
}

enum class AdminBrowserProfile(val apiValue: String) {
    Chrome("chrome"),
    Firefox("firefox"),
    Safari("safari"),
    Edge("edge"),
    Random("random");

    companion object {
        fun fromApi(value: String): AdminBrowserProfile =
            entries.firstOrNull { it.apiValue == value } ?: Chrome
    }
}

@Immutable
data class AdminObfuscation(
    val profile: AdminObfuscationProfile = AdminObfuscationProfile.Http3,
    val intensity: AdminObfuscationIntensity = AdminObfuscationIntensity.High,
    val browser: AdminBrowserProfile = AdminBrowserProfile.Chrome,
    val mtu: Int = DEFAULT_MTU,
    val jcMin: Int = 8,
    val jcMax: Int = 12,
    val jminMin: Int = 40,
    val jminMax: Int = 80,
    val jmaxExtraMin: Int = 60,
    val jmaxExtraMax: Int = 180,
    val sMin: Int = DEFAULT_S_MIN,
    val sMax: Int = 128,
    val hosts: List<String> = DEFAULT_HOSTS,
    val randomTrailers: Boolean = true,
    val disableCookies: Boolean = false,
    val keepaliveMin: Int = 15,
    val keepaliveMax: Int = 25,
) {
    companion object {
        const val DEFAULT_MTU = 1420
        const val DEFAULT_S_MIN = 12
        val DEFAULT_HOSTS = listOf("cloudflare.com", "www.google.com")
    }
}

@Immutable
data class AdminPanelSettings(
    val obfuscation: AdminObfuscation = AdminObfuscation(),
    val shareDefaultTtlSecs: Long = 86_400,
    val statsRetentionDays: Int = 90,
)

@Immutable
data class AdminSettingsErrors(
    val mtu: AdminMessage? = null,
    val jc: AdminMessage? = null,
    val jmin: AdminMessage? = null,
    val jmax: AdminMessage? = null,
    val s: AdminMessage? = null,
    val keepalive: AdminMessage? = null,
    val hosts: AdminMessage? = null,
    val shareTtl: AdminMessage? = null,
    val retention: AdminMessage? = null,
) {
    val isValid: Boolean
        get() =
            listOf(mtu, jc, jmin, jmax, s, keepalive, hosts, shareTtl, retention).all { it == null }
}

@Immutable
data class AdminSettingsDraft(
    val profile: AdminObfuscationProfile = AdminObfuscationProfile.Http3,
    val intensity: AdminObfuscationIntensity = AdminObfuscationIntensity.High,
    val browser: AdminBrowserProfile = AdminBrowserProfile.Chrome,
    val mtu: String = AdminObfuscation.DEFAULT_MTU.toString(),
    val jcMin: String = "8",
    val jcMax: String = "12",
    val jminMin: String = "40",
    val jminMax: String = "80",
    val jmaxExtraMin: String = "60",
    val jmaxExtraMax: String = "180",
    val sMin: String = AdminObfuscation.DEFAULT_S_MIN.toString(),
    val sMax: String = "128",
    val hosts: String = AdminObfuscation.DEFAULT_HOSTS.joinToString("\n"),
    val randomTrailers: Boolean = true,
    val disableCookies: Boolean = false,
    val keepaliveMin: String = "15",
    val keepaliveMax: String = "25",
    val shareTtl: String = "86400",
    val retentionDays: String = "90",
) {
    val hostList: List<String>
        get() = hosts.split('\n').map(String::trim).filter(String::isNotEmpty)

    companion object {
        fun from(settings: AdminPanelSettings): AdminSettingsDraft {
            val obfuscation = settings.obfuscation
            return AdminSettingsDraft(
                profile = obfuscation.profile,
                intensity = obfuscation.intensity,
                browser = obfuscation.browser,
                mtu = obfuscation.mtu.toString(),
                jcMin = obfuscation.jcMin.toString(),
                jcMax = obfuscation.jcMax.toString(),
                jminMin = obfuscation.jminMin.toString(),
                jminMax = obfuscation.jminMax.toString(),
                jmaxExtraMin = obfuscation.jmaxExtraMin.toString(),
                jmaxExtraMax = obfuscation.jmaxExtraMax.toString(),
                sMin = obfuscation.sMin.toString(),
                sMax = obfuscation.sMax.toString(),
                hosts = obfuscation.hosts.joinToString("\n"),
                randomTrailers = obfuscation.randomTrailers,
                disableCookies = obfuscation.disableCookies,
                keepaliveMin = obfuscation.keepaliveMin.toString(),
                keepaliveMax = obfuscation.keepaliveMax.toString(),
                shareTtl = settings.shareDefaultTtlSecs.toString(),
                retentionDays = settings.statsRetentionDays.toString(),
            )
        }
    }
}

enum class AdminSettingsNumberField {
    Mtu,
    JcMin,
    JcMax,
    JminMin,
    JminMax,
    JmaxExtraMin,
    JmaxExtraMax,
    SMin,
    SMax,
    KeepaliveMin,
    KeepaliveMax,
    ShareTtl,
    RetentionDays,
}
