package space.ivlev.umbravpn.account

import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.model.account.AccountQuota

class AccountFormatTest {
    @Test
    fun formatsBytesWithBinaryUnits() {
        assertEquals("0 B", AccountFormat.bytes(0))
        assertEquals("512 B", AccountFormat.bytes(512))
        assertEquals("1 KB", AccountFormat.bytes(1024))
        assertEquals("1.5 KB", AccountFormat.bytes(1536))
        assertEquals("5 GB", AccountFormat.bytes(5_368_709_120L))
        assertEquals("100 GB", AccountFormat.bytes(107_374_182_400L))
        assertEquals("1 TB", AccountFormat.bytes(1_099_511_627_776L))
        assertEquals("1.4 GB", AccountFormat.bytes(1_500_000_000L))
    }

    @Test
    fun formatsPercent() {
        assertEquals("5%", AccountFormat.percent(5.0))
        assertEquals("5.4%", AccountFormat.percent(5.4))
        assertEquals("100%", AccountFormat.percent(150.0))
        assertEquals("0%", AccountFormat.percent(-1.0))
        assertNull(AccountFormat.percent(null))
        assertNull(AccountFormat.percent(Double.NaN))
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

        assertEquals("1 MB / 10 MB", AccountFormat.quotaUsed(quota))
        assertEquals("1 MB", AccountFormat.quotaUsed(quota.copy(quotaBytes = null)))
    }

    @Test
    fun formatsDateInRequestedZone() {
        val instant = Instant.parse("2026-02-01T00:00:00Z")

        assertEquals("01.02.2026", AccountFormat.date(instant, ZoneOffset.UTC))
        assertNull(AccountFormat.date(null))
    }
}
