package space.ivlev.umbravpn.sync

import org.junit.Assert.assertEquals
import org.junit.Test
import space.ivlev.umbravpn.data.sync.uniqueTunnelName

class TunnelNameUniquenessTest {

    @Test
    fun keepsNameWhenFree() {
        assertEquals("Pixel", uniqueTunnelName("Pixel", emptySet()))
    }

    @Test
    fun addsTwoSuffixOnConflict() {
        assertEquals("Pixel (2)", uniqueTunnelName("Pixel", setOf("Pixel")))
    }

    @Test
    fun incrementsSuffixUntilFree() {
        assertEquals("Pixel (3)", uniqueTunnelName("Pixel", setOf("Pixel", "Pixel (2)")))
    }

    @Test
    fun reusesBaseOfSuffixedName() {
        assertEquals("Pixel (3)", uniqueTunnelName("Pixel (2)", setOf("Pixel (2)")))
        assertEquals("Pixel (2)", uniqueTunnelName("Pixel (2)", setOf("Pixel")))
    }

    @Test
    fun fallsBackToDefaultWhenBlank() {
        assertEquals("Umbra VPN", uniqueTunnelName("   ", emptySet()))
    }
}
