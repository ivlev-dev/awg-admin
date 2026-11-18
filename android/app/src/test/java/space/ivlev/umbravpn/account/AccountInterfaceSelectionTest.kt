package space.ivlev.umbravpn.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountInterfaceSelection
import space.ivlev.umbravpn.domain.model.account.AccountInterface

class AccountInterfaceSelectionTest {
    private val single = listOf(AccountInterface(id = "iface-1", name = "awg0"))
    private val multiple =
        listOf(
            AccountInterface(id = "iface-1", name = "awg0", nodeName = "Frankfurt"),
            AccountInterface(id = "iface-2", name = "awg1", nodeName = "Amsterdam"),
        )

    @Test
    fun initialSelectionSelectsAllInterfacesWhenMultiple() {
        assertEquals(
            setOf("iface-1", "iface-2"),
            AccountInterfaceSelection.initialSelection(multiple),
        )
        assertTrue(AccountInterfaceSelection.isSelectable(multiple))
    }

    @Test
    fun singleInterfaceIsNotSelectableAndSendsEmptyPayload() {
        assertFalse(AccountInterfaceSelection.isSelectable(single))
        assertTrue(AccountInterfaceSelection.initialSelection(single).isEmpty())
        assertEquals(
            emptyList<String>(),
            AccountInterfaceSelection.payload(single, setOf("iface-1")),
        )
    }

    @Test
    fun payloadKeepsInterfaceOrderAndDropsUnselected() {
        val selected = setOf("iface-2")

        assertEquals(listOf("iface-2"), AccountInterfaceSelection.payload(multiple, selected))
    }

    @Test
    fun toggleRemovesAndAddsSelection() {
        val selected = AccountInterfaceSelection.initialSelection(multiple)

        val withoutFirst = AccountInterfaceSelection.toggle(selected, "iface-1")
        assertEquals(setOf("iface-2"), withoutFirst)
        assertEquals(
            setOf("iface-1", "iface-2"),
            AccountInterfaceSelection.toggle(withoutFirst, "iface-1"),
        )
    }

    @Test
    fun validationRequiresAtLeastOneSelectionWhenMultiple() {
        assertFalse(AccountInterfaceSelection.isValid(multiple, emptySet()))
        assertTrue(AccountInterfaceSelection.isValid(multiple, setOf("iface-1")))
        assertTrue(AccountInterfaceSelection.isValid(single, emptySet()))
    }
}
