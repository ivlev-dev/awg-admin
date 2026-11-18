package space.ivlev.umbravpn.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountTunnelDraft
import space.ivlev.umbravpn.domain.model.account.AccountInterface

class AccountTunnelDraftTest {
    private val interfaces =
        listOf(
            AccountInterface(id = "iface-1", name = "awg0", nodeName = "Frankfurt"),
            AccountInterface(id = "iface-2", name = "awg1", nodeName = "Amsterdam"),
        )

    @Test
    fun firstInterfaceIsSelectedByDefaultWithItsNameAsLabel() {
        val initial = AccountTunnelDraft.initialInterface(interfaces)

        assertEquals("iface-1", initial?.id)
        assertEquals("awg0", AccountTunnelDraft.defaultLabel(initial))
    }

    @Test
    fun interfacesWithoutIdsAreIgnored() {
        val withBlank = interfaces + AccountInterface(id = " ", name = "bad")

        assertEquals(interfaces, AccountTunnelDraft.interfaces(withBlank))
        assertNull(AccountTunnelDraft.initialInterface(emptyList()))
        assertEquals("", AccountTunnelDraft.defaultLabel(null))
    }

    @Test
    fun emptyLabelIsRejected() {
        assertEquals(AccountMessage.EmptyTunnelLabel, AccountTunnelDraft.labelError(" "))
        assertFalse(AccountTunnelDraft.isValid("iface-1", "  "))
    }

    @Test
    fun tooLongLabelIsRejected() {
        val label = "a".repeat(AccountTunnelDraft.MAX_LABEL_LENGTH + 1)

        assertEquals(AccountMessage.TunnelLabelTooLong, AccountTunnelDraft.labelError(label))
        assertFalse(AccountTunnelDraft.isValid("iface-1", label))
    }

    @Test
    fun validPayloadTrimsLabelAndRequiresInterface() {
        assertEquals(
            "iface-2" to "Home",
            AccountTunnelDraft.payload("iface-2", "  Home  "),
        )
        assertNull(AccountTunnelDraft.payload(null, "Home"))
        assertNull(AccountTunnelDraft.payload(" ", "Home"))
        assertTrue(AccountTunnelDraft.isValid("iface-1", "a".repeat(64)))
    }

    @Test
    fun emptyLabelFallsBackToInterfaceName() {
        assertEquals("awg1", AccountTunnelDraft.preventEmptyLabel(" ", "awg1"))
        assertEquals("custom", AccountTunnelDraft.preventEmptyLabel("custom", "awg1"))
    }
}
