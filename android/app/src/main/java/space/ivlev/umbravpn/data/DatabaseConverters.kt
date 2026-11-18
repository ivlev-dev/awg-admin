package space.ivlev.umbravpn.data

import androidx.room.TypeConverter
import kotlinx.serialization.json.Json
import space.ivlev.umbravpn.domain.enums.BootstrapDnsProtocol
import space.ivlev.umbravpn.domain.enums.ForeignDnsPolicy
import space.ivlev.umbravpn.domain.enums.SplitDnsSuffixTarget
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.domain.enums.TunnelDnsProtocol
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.enums.WifiDetectionMethod

class DatabaseConverters {
    @TypeConverter
    fun listToString(value: List<String>): String {
        return Json.encodeToString(value)
    }

    @TypeConverter
    fun stringToList(value: String): List<String> {
        if (value.isBlank() || value == "[]") return emptyList()

        return try {
            Json.decodeFromString<List<String>>(value)
        } catch (e: Exception) {
            value.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        }
    }

    @TypeConverter
    fun mapToString(map: Map<String, String>): String {
        return Json.encodeToString(map)
    }

    @TypeConverter
    fun stringToMap(json: String): Map<String, String> {
        return if (json.isEmpty() || json == "{}") {
            emptyMap()
        } else {
            try {
                Json.decodeFromString<Map<String, String>>(json)
            } catch (_: Exception) {
                emptyMap()
            }
        }
    }

    @TypeConverter fun fromStatus(status: WifiDetectionMethod): Int = status.value

    @TypeConverter
    fun toStatus(value: Int): WifiDetectionMethod = WifiDetectionMethod.fromValue(value)

    @TypeConverter fun toMode(value: Int): TunnelMode = TunnelMode.fromValue(value)

    @TypeConverter fun fromMode(mode: TunnelMode): Int = mode.value

    @TypeConverter
    fun toDnsProtocol(value: Int): BootstrapDnsProtocol = BootstrapDnsProtocol.fromValue(value)

    @TypeConverter fun fromDnsProtocol(mode: BootstrapDnsProtocol): Int = mode.value

    @TypeConverter fun toTunnelDnsMode(value: Int): TunnelDnsMode = TunnelDnsMode.fromValue(value)

    @TypeConverter fun fromTunnelDnsMode(mode: TunnelDnsMode): Int = mode.value

    @TypeConverter
    fun toTunnelDnsProtocol(value: Int): TunnelDnsProtocol = TunnelDnsProtocol.fromValue(value)

    @TypeConverter fun fromTunnelDnsProtocol(protocol: TunnelDnsProtocol): Int = protocol.value

    @TypeConverter
    fun toForeignDnsPolicy(value: Int): ForeignDnsPolicy = ForeignDnsPolicy.fromValue(value)

    @TypeConverter fun fromForeignDnsPolicy(policy: ForeignDnsPolicy): Int = policy.value

    @TypeConverter
    fun toSplitDnsSuffixTarget(value: Int): SplitDnsSuffixTarget =
        SplitDnsSuffixTarget.fromValue(value)

    @TypeConverter fun fromSplitDnsSuffixTarget(target: SplitDnsSuffixTarget): Int = target.value
}
