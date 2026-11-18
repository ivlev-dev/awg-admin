package space.ivlev.umbravpn.domain.account

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToLong
import space.ivlev.umbravpn.domain.model.account.AccountQuota

object AccountFormat {
    fun bytes(value: Long, locale: Locale = Locale.getDefault()): String {
        if (value < 0) return "0 B"
        if (value < KIB) return "$value B"

        val units = listOf("KB", "MB", "GB", "TB", "PB")
        var amount = value.toDouble() / KIB
        var index = 0
        while (amount >= KIB && index < units.lastIndex) {
            amount /= KIB
            index++
        }
        return "${number(amount, locale)} ${units[index]}"
    }

    fun percent(value: Double?, locale: Locale = Locale.getDefault()): String? {
        if (value == null || value.isNaN() || value.isInfinite()) return null
        return "${number(value.coerceIn(0.0, 100.0), locale)}%"
    }

    fun quotaPercent(quota: AccountQuota): Double? {
        quota.percent?.let {
            return it.coerceIn(0.0, 100.0)
        }
        val limit = quota.quotaBytes ?: return null
        if (limit <= 0L) return null
        return (quota.usedBytes.toDouble() / limit.toDouble() * 100.0).coerceIn(0.0, 100.0)
    }

    fun date(
        instant: Instant?,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String? = instant?.let {
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zone)
            .format(it)
    }

    fun quotaUsed(quota: AccountQuota, locale: Locale = Locale.getDefault()): String =
        if (quota.quotaBytes == null) bytes(quota.usedBytes, locale)
        else "${bytes(quota.usedBytes, locale)} / ${bytes(quota.quotaBytes, locale)}"

    fun unlimited(): String = "∞"

    private fun number(amount: Double, locale: Locale): String {
        val rounded = amount.roundToLong()
        val format =
            NumberFormat.getNumberInstance(locale).apply {
                maximumFractionDigits = if (amount >= 100 || amount == rounded.toDouble()) 0 else 1
                minimumFractionDigits = 0
            }
        return format.format(amount)
    }

    private const val KIB = 1024.0
}
