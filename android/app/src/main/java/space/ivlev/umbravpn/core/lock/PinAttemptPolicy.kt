package space.ivlev.umbravpn.core.lock

/** Consecutive failed PIN attempts and, when locked, the time until another attempt is allowed. */
data class PinAttemptState(val failures: Int = 0, val lockedUntilEpochMs: Long = 0L)

/**
 * Backoff for wrong PINs: the first [maxAttempts] failures are free, then lockouts of 30 s, 60 s
 * and 5 minutes apply.
 */
class PinAttemptPolicy(
    private val maxAttempts: Int = DEFAULT_MAX_ATTEMPTS,
    private val lockoutSeconds: List<Long> = DEFAULT_LOCKOUTS,
) {
    fun afterFailure(state: PinAttemptState, nowMs: Long): PinAttemptState {
        val failures = state.failures + 1
        if (failures < maxAttempts) {
            return PinAttemptState(failures = failures, lockedUntilEpochMs = 0L)
        }
        val stage = (failures - maxAttempts).coerceIn(0, lockoutSeconds.lastIndex)
        return PinAttemptState(
            failures = failures,
            lockedUntilEpochMs = nowMs + lockoutSeconds[stage] * 1_000L,
        )
    }

    fun afterSuccess(): PinAttemptState = PinAttemptState()

    fun isLocked(state: PinAttemptState, nowMs: Long): Boolean = remainingSeconds(state, nowMs) > 0

    fun remainingSeconds(state: PinAttemptState, nowMs: Long): Long {
        val millis = state.lockedUntilEpochMs - nowMs
        if (millis <= 0L) return 0L
        return (millis + 999L) / 1_000L
    }

    /** Attempts left before the first lockout, 0 once locked. */
    fun attemptsLeft(state: PinAttemptState): Int = (maxAttempts - state.failures).coerceAtLeast(0)

    companion object {
        const val DEFAULT_MAX_ATTEMPTS = 5
        val DEFAULT_LOCKOUTS = listOf(30L, 60L, 300L)
    }
}
