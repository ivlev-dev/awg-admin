package space.ivlev.umbravpn.core.broadcast

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteControlAuthTest {
    @Test
    fun matchingKeyIsAccepted() {
        assertTrue(RemoteControlAuth.matchesKey("secret-key", "secret-key"))
        assertTrue(RemoteControlAuth.matchesKey(" secret-key ", "secret-key"))
    }

    @Test
    fun differentKeyIsRejected() {
        assertFalse(RemoteControlAuth.matchesKey("secret-key", "secret-kez"))
        assertFalse(RemoteControlAuth.matchesKey("secret-key", "secret-key-longer"))
    }

    @Test
    fun missingKeyIsRejected() {
        assertFalse(RemoteControlAuth.matchesKey(null, "secret-key"))
        assertFalse(RemoteControlAuth.matchesKey("secret-key", null))
        assertFalse(RemoteControlAuth.matchesKey("", ""))
        assertFalse(RemoteControlAuth.matchesKey("  ", "  "))
    }
}
