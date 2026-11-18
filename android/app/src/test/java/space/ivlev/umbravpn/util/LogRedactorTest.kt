package space.ivlev.umbravpn.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LogRedactorTest {
    @Test
    fun redactsPrivateKeyBlocks() {
        val message =
            """
            config:
            -----BEGIN PRIVATE KEY-----
            c2VjcmV0LWtleQ==
            -----END PRIVATE KEY-----
            end
            """
                .trimIndent()

        val redacted = LogRedactor.redact(message)

        assertFalse(redacted.contains("c2VjcmV0LWtleQ=="))
        assertTrue(redacted.contains("[redacted]"))
        assertTrue(redacted.contains("end"))
    }

    @Test
    fun redactsKeyValueSecrets() {
        val redacted =
            LogRedactor.redact(
                "PrivateKey = YWJjZGVmZ2hpamtsbW5vcA== token: abc123 password=hunter2",
            )

        assertFalse(redacted.contains("YWJjZGVmZ2hpamtsbW5vcA=="))
        assertFalse(redacted.contains("abc123"))
        assertFalse(redacted.contains("hunter2"))
    }

    @Test
    fun redactsLongBase64WireGuardKeys() {
        val key = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk="

        val redacted = LogRedactor.redact("peer key $key loaded")

        assertFalse(redacted.contains(key))
    }

    @Test
    fun keepsOrdinaryMessages() {
        assertEquals(
            "tunnel started on port 51820",
            LogRedactor.redact("tunnel started on port 51820"),
        )
    }
}
