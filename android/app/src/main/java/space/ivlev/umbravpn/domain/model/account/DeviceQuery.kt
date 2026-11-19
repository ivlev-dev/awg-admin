package space.ivlev.umbravpn.domain.model.account

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.model.Page

enum class DeviceStatusFilter(val apiValue: String) {
    All("all"),
    Active("active"),
    Revoked("revoked");

    companion object {
        fun fromApi(value: String?): DeviceStatusFilter =
            entries.firstOrNull { it.apiValue == value?.trim()?.lowercase() } ?: All
    }
}

@Immutable
data class DeviceQuery(
    val limit: Int = DEFAULT_LIMIT,
    val offset: Int = 0,
    val query: String = "",
    val status: DeviceStatusFilter = DeviceStatusFilter.All,
) {
    val normalized: DeviceQuery
        get() =
            copy(
                limit = limit.coerceIn(1, MAX_LIMIT),
                offset = offset.coerceAtLeast(0),
                query = query.trim(),
            )

    fun matches(device: AccountDevice): Boolean {
        val accepted =
            when (status) {
                DeviceStatusFilter.All -> true
                DeviceStatusFilter.Active -> !device.revoked
                DeviceStatusFilter.Revoked -> device.revoked
            }
        if (!accepted) return false
        val text = query.trim()
        if (text.isEmpty()) return true
        return device.name.contains(text, ignoreCase = true) ||
            device.addresses.any { it.contains(text, ignoreCase = true) }
    }

    companion object {
        const val DEFAULT_LIMIT = 20
        const val MAX_LIMIT = 100
    }
}

fun List<AccountDevice>.filterDevices(query: DeviceQuery): List<AccountDevice> {
    val normalized = query.normalized
    return filter(normalized::matches)
}

fun List<AccountDevice>.pageDevices(query: DeviceQuery): Page<AccountDevice> {
    val normalized = query.normalized
    val filtered = filterDevices(normalized)
    return Page(
        items = filtered.drop(normalized.offset).take(normalized.limit),
        total = filtered.size,
        limit = normalized.limit,
        offset = normalized.offset,
    )
}
