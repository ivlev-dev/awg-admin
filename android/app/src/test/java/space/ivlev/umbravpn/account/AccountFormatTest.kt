package space.ivlev.umbravpn.account

import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.model.account.AccountQuota

class AccountFormatTest {
    private val us = Locale.US
    private val ru = Locale.forLanguageTag("ru-RU")

    @Test
    fun formatsBytesWithBinaryUnits() {
        assertEquals("0 B", AccountFormat.bytes(0, us))
        assertEquals("512 B", AccountFormat.bytes(512, us))
        assertEquals("1 KB", AccountFormat.bytes(1024, us))
        assertEquals("1.5 KB", AccountFormat.bytes(1536, us))
        assertEquals("5 GB", AccountFormat.bytes(5_368_709_120L, us))
        assertEquals("100 GB", AccountFormat.bytes(107_374_182_400L, us))
        assertEquals("1 TB", AccountFormat.bytes(1_099_511_627_776L, us))
        assertEquals("1.4 GB", AccountFormat.bytes(1_500_000_000L, us))
    }

    @Test
    fun usesLocaleDecimalSeparator() {
        assertEquals("1,5 MB", AccountFormat.bytes(1_572_864L, ru))
        assertEquals("5,4%", AccountFormat.percent(5.4, ru))
        assertEquals("1.5 MB", AccountFormat.bytes(1_572_864L, us))
    }

    @Test
    fun formatsPercent() {
        assertEquals("5%", AccountFormat.percent(5.0, us))
        assertEquals("5.4%", AccountFormat.percent(5.4, us))
        assertEquals("100%", AccountFormat.percent(150.0, us))
        assertEquals("0%", AccountFormat.percent(-1.0, us))
        assertNull(AccountFormat.percent(null, us))
        assertNull(AccountFormat.percent(Double.NaN, us))
    }

    @Test
    fun quotaPercentPrefersServerValueAndFallsBackToBytes() {
        val quota =
            AccountQuota(
                usedBytes = 5_368_709_120L,
                quotaBytes = 107_374_182_400L,
                exceeded = false,
                remainingBytes = null,
                percent = null,
                periodStart = null,
                periodEnd = null,
                resetAt = null,
            )

        assertEquals(5.0, AccountFormat.quotaPercent(quota)!!, 0.001)
        assertEquals(42.0, AccountFormat.quotaPercent(quota.copy(percent = 42.0))!!, 0.001)
    }

    @Test
    fun formatsQuotaUsedWithAndWithoutLimit() {
        val quota =
            AccountQuota(
                usedBytes = 1_048_576L,
                quotaBytes = 10_485_760L,
                exceeded = false,
                remainingBytes = null,
                percent = 10.0,
                periodStart = null,
                periodEnd = null,
                resetAt = null,
            )

        assertEquals("1 MB / 10 MB", AccountFormat.quotaUsed(quota, us))
        assertEquals("1 MB", AccountFormat.quotaUsed(quota.copy(quotaBytes = null), us))
    }

    @Test
    fun formatsDateInRequestedZoneAndLocale() {
        val instant = Instant.parse("2026-02-01T00:00:00Z")

        assertEquals("Feb 1, 2026", AccountFormat.date(instant, ZoneOffset.UTC, us))
        val localizedRu = AccountFormat.date(instant, ZoneOffset.UTC, ru)
        assertNotEquals("01.02.2026", localizedRu)
        assertTrue(localizedRu?.contains("2026") == true)
        assertNull(AccountFormat.date(null, ZoneOffset.UTC, us))
    }
}
