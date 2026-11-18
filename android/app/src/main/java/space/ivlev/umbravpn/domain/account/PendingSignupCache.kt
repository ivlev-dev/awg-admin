package space.ivlev.umbravpn.domain.account

data class PendingSignup(val email: String, val password: String)

class PendingSignupCache {
    private var signup: PendingSignup? = null

    @Synchronized
    fun remember(email: String, password: String) {
        signup = PendingSignup(email = email.trim(), password = password)
    }

    @Synchronized
    fun find(email: String?): PendingSignup? {
        val cached = signup ?: return null
        if (email.isNullOrBlank()) return cached
        return cached.takeIf { it.email.equals(email.trim(), ignoreCase = true) }
    }

    @Synchronized fun lastEmail(): String? = signup?.email

    @Synchronized
    fun clear() {
        signup = null
    }
}
