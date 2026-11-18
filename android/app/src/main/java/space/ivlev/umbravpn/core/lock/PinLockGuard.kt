package space.ivlev.umbravpn.core.lock

/**
 * Applies [PinAttemptPolicy] on top of an encrypted [PinAttemptStore]. Shared by the in-app PIN
 * screen and the PIN gate activity so lockouts cannot be bypassed by reopening the app.
 */
class PinLockGuard(
    private val store: PinAttemptStore,
    private val policy: PinAttemptPolicy = PinAttemptPolicy(),
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    fun state(): PinAttemptState = store.load()

    fun isLocked(): Boolean = policy.isLocked(state(), clock())

    fun remainingSeconds(): Long = policy.remainingSeconds(state(), clock())

    fun attemptsLeft(): Int = policy.attemptsLeft(state())

    fun onSuccess() {
        store.save(policy.afterSuccess())
    }

    fun onFailure(): PinAttemptState {
        val next = policy.afterFailure(state(), clock())
        store.save(next)
        return next
    }
}
