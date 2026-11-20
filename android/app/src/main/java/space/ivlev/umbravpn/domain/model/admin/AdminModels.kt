package space.ivlev.umbravpn.domain.model.admin

import androidx.compose.runtime.Immutable
import java.time.Instant
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

@Immutable
data class AdminUser(
    val id: String,
    val email: String,
    val fullName: String? = null,
    val status: UserStatus,
    val role: UserRole,
    val tariffId: String? = null,
    val nodeId: String? = null,
    val groupId: String? = null,
    val disabled: Boolean = false,
    val createdAt: Instant? = null,
) {
    val displayName: String
        get() = fullName?.takeIf { it.isNotBlank() } ?: email
}

@Immutable
data class AdminTariff(
    val id: String,
    val name: String,
    val description: String = "",
    val maxDevices: Int = 0,
    val deviceDownKbps: Int = 0,
    val deviceUpKbps: Int = 0,
    val trafficQuotaBytes: Long? = null,
    val interfaceId: String? = null,
    val interfaceName: String? = null,
)

@Immutable
data class AdminOverview(
    val users: Int = 0,
    val devices: Int = 0,
    val nodesOnline: Int = 0,
    val nodesTotal: Int = 0,
    val interfaces: Int = 0,
    val groups: Int = 0,
    val today: AdminTrafficTotals = AdminTrafficTotals(),
    val month: AdminTrafficTotals = AdminTrafficTotals(),
    val rxBps: Double = 0.0,
    val txBps: Double = 0.0,
    val topDevices: List<AdminTopDevice> = emptyList(),
)

@Immutable
data class AdminDashboard(
    val overview: AdminOverview = AdminOverview(),
    val pendingUsers: Int = 0,
)

@Immutable data class AdminOption(val id: String, val label: String)

@Immutable
data class AdminNode(
    val id: String,
    val name: String,
    val online: Boolean = false,
    val lastSeen: Instant? = null,
    val version: String? = null,
    val interfaces: Int = 0,
    val tokenIssuedAt: Instant? = null,
    val cpuLoad: Double? = null,
    val memUsedBytes: Long? = null,
    val memTotalBytes: Long? = null,
    val kernelVersion: String? = null,
    val workerVersion: String? = null,
    val uptimeSecs: Long? = null,
)

@Immutable data class AdminNodeDraft(val name: String)

@Immutable
data class AdminNodeSecret(
    val nodeId: String,
    val nodeName: String,
    val token: String,
)

@Immutable
data class AdminInterface(
    val id: String,
    val groupId: String,
    val groupName: String = "",
    val nodeId: String,
    val nodeName: String = "",
    val name: String,
    val label: String = "",
    val endpointHost: String,
    val endpointPort: Int,
    val listenPort: Int,
    val mtu: Int,
    val publicKey: String = "",
    val enabled: Boolean = true,
    val peers: Int = 0,
)

@Immutable
data class AdminInterfaceDraft(
    val groupId: String,
    val nodeId: String,
    val name: String,
    val label: String = "",
    val endpointHost: String,
    val endpointPort: Int,
    val listenPort: Int,
    val mtu: Int,
)

@Immutable
data class AdminInterfaceUpdate(
    val label: String,
    val endpointHost: String,
    val endpointPort: Int,
    val listenPort: Int,
    val mtu: Int,
    val enabled: Boolean,
)

@Immutable
data class AdminGroup(
    val id: String,
    val name: String,
    val description: String = "",
    val baseCidr: String = "",
    val forwardingDefault: Boolean = false,
    val interfaces: Int = 0,
    val devices: Int = 0,
)

@Immutable
data class AdminGroupDraft(
    val name: String,
    val description: String = "",
    val baseCidr: String,
    val forwardingDefault: Boolean = false,
)

enum class AdminPoolMode(val apiValue: String) {
    Auto("auto"),
    RfOnly("rf_only"),
    ExternalOnly("external_only");

    companion object {
        fun fromApi(value: String): AdminPoolMode =
            entries.firstOrNull { it.apiValue == value } ?: Auto
    }
}

@Immutable
data class AdminPool(
    val id: String,
    val groupId: String,
    val name: String,
    val cidr: String,
    val mode: AdminPoolMode = AdminPoolMode.Auto,
    val gateway: String? = null,
    val enabled: Boolean = true,
)

@Immutable
data class AdminPoolDraft(
    val name: String,
    val cidr: String,
    val mode: AdminPoolMode = AdminPoolMode.Auto,
    val gateway: String? = null,
)

@Immutable
data class AdminPoolUpdate(
    val mode: AdminPoolMode,
    val gateway: String? = null,
    val enabled: Boolean,
)

enum class AdminUserTab(val apiValue: String) {
    Active("active"),
    Pending("pending"),
}

enum class AdminRoleFilter(val apiValue: String) {
    All("all"),
    Admin("admin"),
    User("user"),
}

enum class AdminStatusFilter(val apiValue: String) {
    All("all"),
    Active("active"),
    Disabled("disabled"),
}

@Immutable
data class AdminUserQuery(
    val limit: Int = DEFAULT_LIMIT,
    val offset: Int = 0,
    val query: String = "",
    val tab: AdminUserTab = AdminUserTab.Active,
    val role: AdminRoleFilter = AdminRoleFilter.All,
    val status: AdminStatusFilter = AdminStatusFilter.All,
) {
    val hasFilters: Boolean
        get() = role != AdminRoleFilter.All || status != AdminStatusFilter.All

    companion object {
        const val DEFAULT_LIMIT = 20
    }
}

@Immutable
data class AdminUserDraft(
    val email: String,
    val fullName: String? = null,
    val role: UserRole = UserRole.User,
    val tariffId: String? = null,
    val nodeId: String? = null,
    val groupId: String? = null,
    val disabled: Boolean = false,
    val password: String? = null,
)

@Immutable
data class AdminTariffDraft(
    val name: String,
    val description: String = "",
    val maxDevices: Int = 1,
    val deviceDownKbps: Int = 0,
    val deviceUpKbps: Int = 0,
    val trafficQuotaBytes: Long? = null,
    val interfaceId: String? = null,
)

@Immutable
data class AdminCatalogs(
    val tariffs: List<AdminOption> = emptyList(),
    val nodes: List<AdminOption> = emptyList(),
    val groups: List<AdminOption> = emptyList(),
    val interfaces: List<AdminOption> = emptyList(),
)
