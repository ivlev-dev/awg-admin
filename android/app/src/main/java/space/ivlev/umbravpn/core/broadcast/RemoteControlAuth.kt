package space.ivlev.umbravpn.core.broadcast

import java.security.MessageDigest

/**
 * Authentication for the exported remote control receiver.
 *
 * The receiver is intentionally exported for automation apps such as Tasker, which cannot hold an
 * app signature permission. The shared secret configured by the user is therefore the authorization
 * factor. Keys are compared in constant time and never logged.
 */
internal object RemoteControlAuth {
    fun matchesKey(expected: String?, provided: String?): Boolean {
        val expectedKey = expected?.trim().orEmpty()
        val providedKey = provided?.trim().orEmpty()
        if (expectedKey.isEmpty() || providedKey.isEmpty()) return false
        return MessageDigest.isEqual(hash(expectedKey), hash(providedKey))
    }

    private fun hash(value: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
