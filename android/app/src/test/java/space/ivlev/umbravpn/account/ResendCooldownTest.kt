package space.ivlev.umbravpn.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.ResendCooldown

class ResendCooldownTest {
    private var now = 1_000_000L

    private fun cooldown() = ResendCooldown(cooldownMillis = 60_000L, now = { now })

    @Test
    fun allowsFirstSend() {
        val cooldown = cooldown()

        assertTrue(cooldown.canResend())
        assertEquals(0, cooldown.remainingSeconds())
    }

    @Test
    fun blocksSendingForOneMinute() {
        val cooldown = cooldown()
        cooldown.markSent()

        assertFalse(cooldown.canResend())
        assertEquals(60, cooldown.remainingSeconds())

        now += 30_000L
        assertFalse(cooldown.canResend())
        assertEquals(30, cooldown.remainingSeconds())

        now += 30_000L
        assertTrue(cooldown.canResend())
        assertEquals(0, cooldown.remainingSeconds())
    }

    @Test
    fun resetUnblocksImmediately() {
        val cooldown = cooldown()
        cooldown.markSent()
        cooldown.reset()

        assertTrue(cooldown.canResend())
    }

    @Test
    fun remainingSecondsRoundsUpPartiallyElapsedSecond() {
        val cooldown = cooldown()
        cooldown.markSent()
        now += 59_500L

        assertEquals(1, cooldown.remainingSeconds())
    }
}
