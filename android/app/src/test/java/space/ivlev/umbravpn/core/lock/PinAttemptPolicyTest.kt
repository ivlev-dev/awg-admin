package space.ivlev.umbravpn.core.lock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinAttemptPolicyTest {
    private val policy = PinAttemptPolicy()
    private val start = 1_000_000L

    @Test
    fun fewWrongAttemptsDoNotLock() {
        var state = PinAttemptState()
        repeat(4) { state = policy.afterFailure(state, start) }

        assertEquals(4, state.failures)
        assertFalse(policy.isLocked(state, start))
        assertEquals(1, policy.attemptsLeft(state))
    }

    @Test
    fun fifthFailureLocksForThirtySeconds() {
        var state = PinAttemptState()
        repeat(5) { state = policy.afterFailure(state, start) }

        assertTrue(policy.isLocked(state, start))
        assertEquals(30L, policy.remainingSeconds(state, start))
        assertFalse(policy.isLocked(state, start + 30_000L))
    }

    @Test
    fun lockoutGrowsForFurtherFailures() {
        var state = PinAttemptState()
        repeat(6) { state = policy.afterFailure(state, start) }
        assertEquals(60L, policy.remainingSeconds(state, start))

        repeat(4) { state = policy.afterFailure(state, start + 61_000L) }
        assertEquals(300L, policy.remainingSeconds(state, start + 61_000L))
    }

    @Test
    fun successResetsCounter() {
        var state = PinAttemptState()
        repeat(5) { state = policy.afterFailure(state, start) }

        state = policy.afterSuccess()

        assertEquals(0, state.failures)
        assertFalse(policy.isLocked(state, start))
    }
}
