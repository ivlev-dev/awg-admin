package space.ivlev.umbravpn.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminValidation

class AdminValidationTest {

    @Test
    fun validIpv4AndCidrAreAccepted() {
        assertTrue(AdminValidation.isIpv4("10.8.0.1"))
        assertTrue(AdminValidation.isIpv4("0.0.0.0"))
        assertTrue(AdminValidation.isIpv4("255.255.255.255"))
        assertNull(AdminValidation.cidrError("10.8.0.0/24"))
        assertNull(AdminValidation.cidrError("192.168.1.0/32"))
        assertNull(AdminValidation.gatewayError("10.8.0.1"))
        assertNull(AdminValidation.gatewayError(""))
    }

    @Test
    fun invalidCidrIsRejected() {
        assertEquals(AdminMessage.CidrInvalid, AdminValidation.cidrError("10.8.0.0"))
        assertEquals(AdminMessage.CidrInvalid, AdminValidation.cidrError("10.8.0.0/33"))
        assertEquals(AdminMessage.CidrInvalid, AdminValidation.cidrError("10.8.0.256/24"))
        assertEquals(AdminMessage.CidrInvalid, AdminValidation.cidrError("10.8.0/24"))
        assertEquals(AdminMessage.CidrInvalid, AdminValidation.cidrError("10.8.0.0/abc"))
        assertEquals(AdminMessage.GatewayInvalid, AdminValidation.gatewayError("10.8.0.999"))
    }

    @Test
    fun portsMustFitUshortRange() {
        assertNull(AdminValidation.portError("1"))
        assertNull(AdminValidation.portError("65535"))
        assertEquals(AdminMessage.PortInvalid, AdminValidation.portError("0"))
        assertEquals(AdminMessage.PortInvalid, AdminValidation.portError("65536"))
        assertEquals(AdminMessage.PortInvalid, AdminValidation.portError("-1"))
        assertEquals(AdminMessage.PortInvalid, AdminValidation.portError("abc"))
    }

    @Test
    fun mtuBoundsAreEnforced() {
        assertNull(AdminValidation.mtuError("576"))
        assertNull(AdminValidation.mtuError("9000"))
        assertNull(AdminValidation.mtuError("1420"))
        assertEquals(AdminMessage.MtuInvalid, AdminValidation.mtuError("575"))
        assertEquals(AdminMessage.MtuInvalid, AdminValidation.mtuError("9001"))
        assertEquals(AdminMessage.MtuInvalid, AdminValidation.mtuError(""))
    }

    @Test
    fun interfaceNameMatchesBackendRules() {
        assertNull(AdminValidation.interfaceNameError("awg0"))
        assertNull(AdminValidation.interfaceNameError("awg_1-test"))
        assertEquals(AdminMessage.InterfaceNameInvalid, AdminValidation.interfaceNameError(""))
        assertEquals(
            AdminMessage.InterfaceNameInvalid,
            AdminValidation.interfaceNameError("x".repeat(16)),
        )
        assertEquals(AdminMessage.InterfaceNameInvalid, AdminValidation.interfaceNameError("awg 0"))
        assertEquals(AdminMessage.InterfaceNameInvalid, AdminValidation.interfaceNameError("awg.0"))
    }

    @Test
    fun hostMustBeNonEmptyWithoutSpaces() {
        assertNull(AdminValidation.hostError("vpn.example.com"))
        assertNull(AdminValidation.hostError("192.168.1.1"))
        assertEquals(AdminMessage.HostRequired, AdminValidation.hostError("  "))
        assertEquals(AdminMessage.HostInvalid, AdminValidation.hostError("vpn host"))
        assertEquals(AdminMessage.HostInvalid, AdminValidation.hostError("-vpn"))
        assertEquals(AdminMessage.HostInvalid, AdminValidation.hostError("vpn-"))
    }

    @Test
    fun selectionsAndNamesAreRequired() {
        assertEquals(AdminMessage.NodeRequired, AdminValidation.nodeSelectionError(null))
        assertEquals(AdminMessage.NodeRequired, AdminValidation.nodeSelectionError(" "))
        assertNull(AdminValidation.nodeSelectionError("node-1"))
        assertEquals(AdminMessage.GroupRequired, AdminValidation.groupSelectionError(null))
        assertNull(AdminValidation.groupSelectionError("group-1"))
        assertEquals(AdminMessage.NameRequired, AdminValidation.nodeNameError(" "))
        assertNull(AdminValidation.nodeNameError("Frankfurt"))
        assertFalse(AdminValidation.isIpv4("10.8.0"))
    }
}
