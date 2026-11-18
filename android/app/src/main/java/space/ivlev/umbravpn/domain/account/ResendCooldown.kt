package space.ivlev.umbravpn.domain.account

class ResendCooldown(
    private val cooldownMillis: Long = DEFAULT_COOLDOWN_MILLIS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var availableAtMillis: Long = 0L

    fun canResend(): Boolean = remainingMillis() <= 0L

    fun remainingMillis(): Long = (availableAtMillis - now()).coerceAtLeast(0L)

    fun remainingSeconds(): Int = ((remainingMillis() + 999L) / 1000L).toInt()

    fun markSent() {
        availableAtMillis = now() + cooldownMillis
    }

    fun reset() {
        availableAtMillis = 0L
    }

    private companion object {
        const val DEFAULT_COOLDOWN_MILLIS = 60_000L
    }
}
