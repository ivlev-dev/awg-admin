package space.ivlev.umbravpn.domain.account

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong
import space.ivlev.umbravpn.domain.model.account.AccountQuota

object AccountFormat {
    private val dateFormatter = DateTimeFormatter.ofPattern("dd.MM.yyyy")

    fun bytes(value: Long): String {
        if (value < 0) return "0 B"
        if (value < KIB) return "$value B"

        val units = listOf("KB", "MB", "GB", "TB", "PB")
        var amount = value.toDouble() / KIB
        var index = 0
        while (amount >= KIB && index < units.lastIndex) {
            amount /= KIB
            index++
        }
        val formatted =
            if (amount >= 100 || amount == amount.toLong().toDouble()) {
                amount.roundToLong().toString()
            } else {
                String.format(Locale.ROOT, "%.1f", amount)
            }
        return "$formatted ${units[index]}"
    }

    fun percent(value: Double?): String? {
        if (value == null || value.isNaN() || value.isInfinite()) return null
        val bounded = value.coerceIn(0.0, 100.0)
        val formatted =
            if (bounded == bounded.toLong().toDouble()) {
                bounded.toLong().toString()
            } else {
                String.format(Locale.ROOT, "%.1f", bounded)
            }
        return "$formatted%"
    }

    fun quotaPercent(quota: AccountQuota): Double? {
        quota.percent?.let {
            return it.coerceIn(0.0, 100.0)
        }
        val limit = quota.quotaBytes ?: return null
        if (limit <= 0L) return null
        return (quota.usedBytes.toDouble() / limit.toDouble() * 100.0).coerceIn(0.0, 100.0)
    }

    fun date(instant: Instant?, zone: ZoneId = ZoneId.systemDefault()): String? = instant?.let {
        dateFormatter.withZone(zone).format(it)
    }

    fun quotaUsed(quota: AccountQuota): String =
        if (quota.quotaBytes == null) bytes(quota.usedBytes)
        else "${bytes(quota.usedBytes)} / ${bytes(quota.quotaBytes)}"

    fun unlimited(): String = "∞"

    private const val KIB = 1024.0
}
