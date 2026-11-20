package space.ivlev.umbravpn.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.admin.AdminAuditDetails

class AdminAuditDetailsTest {

    @Test
    fun emptyDetailsProduceNoFields() {
        assertTrue(AdminAuditDetails.fields(null).isEmpty())
        assertTrue(AdminAuditDetails.fields("   ").isEmpty())
    }

    @Test
    fun plainTextDetailsBecomeSingleField() {
        val fields = AdminAuditDetails.fields("user approved manually")

        assertEquals(1, fields.size)
        assertEquals("details", fields.single().name)
        assertEquals("user approved manually", fields.single().value)
        assertFalse(fields.single().redacted)
    }

    @Test
    fun nestedJsonIsFlattened() {
        val fields =
            AdminAuditDetails.fields(
                """{"email":"a@b.c","limits":{"devices":5},"hosts":["one","two"]}""",
            )

        val byName = fields.associateBy { it.name }
        assertEquals("a@b.c", byName["email"]?.value)
        assertEquals("5", byName["limits.devices"]?.value)
        assertEquals("one", byName["hosts[0]"]?.value)
        assertEquals("two", byName["hosts[1]"]?.value)
    }

    @Test
    fun sensitiveKeysAreRedacted() {
        val fields =
            AdminAuditDetails.fields(
                """{"password":"secret","token":"abc","user":{"new_password":"x"},"safe":"ok"}""",
            )

        val byName = fields.associateBy { it.name }
        assertTrue(byName.getValue("password").redacted)
        assertTrue(byName.getValue("token").redacted)
        assertTrue(byName.getValue("user.new_password").redacted)
        assertFalse(byName.getValue("safe").redacted)
        assertEquals("ok", byName.getValue("safe").value)
        assertFalse(byName.getValue("password").value.contains("secret"))
    }

    @Test
    fun secretMarkersAreCaseInsensitive() {
        assertTrue(AdminAuditDetails.isSensitive("RefreshToken"))
        assertTrue(AdminAuditDetails.isSensitive("AUTHORIZATION"))
        assertFalse(AdminAuditDetails.isSensitive("entity_id"))
    }
}
