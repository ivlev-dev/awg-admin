package space.ivlev.umbravpn.data.admin

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class AdminTariffDto(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("max_devices") val maxDevices: Int = 0,
    @SerialName("device_down_kbps") val deviceDownKbps: Int = 0,
    @SerialName("device_up_kbps") val deviceUpKbps: Int = 0,
    @SerialName("traffic_quota_bytes") val trafficQuotaBytes: Long? = null,
    @SerialName("interface_id") val interfaceId: String? = null,
    @SerialName("interface_name") val interfaceName: String? = null,
)

@Serializable
internal data class AdminOverviewDto(
    @SerialName("today") val today: AdminTrafficTotalsDto = AdminTrafficTotalsDto(),
    @SerialName("month") val month: AdminTrafficTotalsDto = AdminTrafficTotalsDto(),
    @SerialName("rx_bps") val rxBps: Double = 0.0,
    @SerialName("tx_bps") val txBps: Double = 0.0,
    @SerialName("nodes_online") val nodesOnline: Int = 0,
    @SerialName("nodes_total") val nodesTotal: Int = 0,
    val interfaces: Int = 0,
    val groups: Int = 0,
    val devices: Int = 0,
    val users: Int = 0,
    @SerialName("top_devices") val topDevices: List<AdminTopDeviceDto> = emptyList(),
)

@Serializable internal data class AdminGroupDto(val id: String, val name: String = "")

@Serializable
internal data class AdminInterfaceOptionDto(
    val id: String,
    val name: String = "",
    @SerialName("node_name") val nodeName: String = "",
)

@Serializable
internal data class AdminNodeDto(
    val id: String,
    val name: String = "",
    val online: Boolean = false,
    val status: String = "offline",
    @SerialName("last_seen") val lastSeen: String? = null,
    val version: String? = null,
    val interfaces: Int = 0,
    @SerialName("token_issued_at") val tokenIssuedAt: String? = null,
    @SerialName("cpu_load") val cpuLoad: Double? = null,
    @SerialName("mem_used_bytes") val memUsedBytes: Long? = null,
    @SerialName("mem_total_bytes") val memTotalBytes: Long? = null,
    @SerialName("kernel_version") val kernelVersion: String? = null,
    @SerialName("worker_version") val workerVersion: String? = null,
    @SerialName("uptime_secs") val uptimeSecs: Long? = null,
)

@Serializable
internal data class AdminCreatedNodeDto(
    val id: String,
    val name: String = "",
)

@Serializable
internal data class AdminNodeCreateDto(
    val node: AdminCreatedNodeDto,
    val token: String = "",
)

@Serializable
internal data class AdminNodeRotateDto(
    val node: AdminNodeDto,
    val token: String = "",
)

@Serializable
internal data class AdminInterfaceDto(
    val id: String,
    @SerialName("group_id") val groupId: String,
    @SerialName("group_name") val groupName: String = "",
    @SerialName("node_id") val nodeId: String,
    @SerialName("node_name") val nodeName: String = "",
    val name: String = "",
    val label: String = "",
    @SerialName("endpoint_host") val endpointHost: String = "",
    @SerialName("endpoint_port") val endpointPort: Int = 0,
    @SerialName("listen_port") val listenPort: Int = 0,
    val mtu: Int = 0,
    @SerialName("public_key") val publicKey: String = "",
    val enabled: Boolean = true,
    val peers: Int = 0,
)

@Serializable
internal data class AdminGroupViewDto(
    val id: String,
    val name: String = "",
    val description: String = "",
    @SerialName("base_cidr") val baseCidr: String = "",
    @SerialName("forwarding_default") val forwardingDefault: Boolean = false,
    val interfaces: Int = 0,
    val devices: Int = 0,
)

@Serializable
internal data class AdminPoolDto(
    val id: String,
    @SerialName("group_id") val groupId: String,
    val name: String = "",
    val cidr: String = "",
    val mode: String = "auto",
    val gateway: String? = null,
    val enabled: Boolean = true,
)
