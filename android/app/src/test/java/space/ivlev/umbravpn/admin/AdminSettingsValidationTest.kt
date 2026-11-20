package space.ivlev.umbravpn.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminSettingsValidation
import space.ivlev.umbravpn.domain.admin.toPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsDraft

class AdminSettingsValidationTest {

    @Test
    fun defaultDraftIsValid() {
        val validation = AdminSettingsValidation.validate(AdminSettingsDraft())

        assertTrue(validation.isValid)
        assertTrue(AdminSettingsDraft().toPanelSettings() != null)
    }

    @Test
    fun mtuOutsideRangeIsRejected() {
        val validation = AdminSettingsValidation.validate(AdminSettingsDraft(mtu = "100"))

        assertEquals(AdminMessage.ValueInvalid, validation.mtu)
        assertFalse(validation.isValid)
    }

    @Test
    fun invertedJunkRangeIsRejected() {
        val validation =
            AdminSettingsValidation.validate(AdminSettingsDraft(jcMin = "20", jcMax = "10"))

        assertEquals(AdminMessage.RangeInvalid, validation.jc)
    }

    @Test
    fun paddingBelowFloorIsRejected() {
        val validation =
            AdminSettingsValidation.validate(AdminSettingsDraft(sMin = "11", sMax = "64"))

        assertEquals(AdminMessage.SFloor, validation.s)
    }

    @Test
    fun keepaliveMustBePositiveAndOrdered() {
        assertEquals(
            AdminMessage.KeepaliveInvalid,
            AdminSettingsValidation.validate(AdminSettingsDraft(keepaliveMin = "0")).keepalive,
        )
        assertEquals(
            AdminMessage.KeepaliveInvalid,
            AdminSettingsValidation.validate(
                    AdminSettingsDraft(keepaliveMin = "30", keepaliveMax = "20"),
                )
                .keepalive,
        )
        assertNull(
            AdminSettingsValidation.validate(
                    AdminSettingsDraft(keepaliveMin = "20", keepaliveMax = "30"),
                )
                .keepalive,
        )
    }

    @Test
    fun hostsRequireAtLeastOneEntry() {
        assertEquals(
            AdminMessage.HostsRequired,
            AdminSettingsValidation.validate(AdminSettingsDraft(hosts = " \n ")).hosts,
        )
        assertNull(
            AdminSettingsValidation.validate(
                    AdminSettingsDraft(hosts = "one.example\ntwo.example"),
                )
                .hosts,
        )
    }

    @Test
    fun shareTtlIsBounded() {
        assertEquals(
            AdminMessage.ShareTtlInvalid,
            AdminSettingsValidation.validate(AdminSettingsDraft(shareTtl = "10")).shareTtl,
        )
        assertEquals(
            AdminMessage.ShareTtlInvalid,
            AdminSettingsValidation.validate(AdminSettingsDraft(shareTtl = "9999999")).shareTtl,
        )
        assertNull(
            AdminSettingsValidation.validate(AdminSettingsDraft(shareTtl = "600")).shareTtl,
        )
    }

    @Test
    fun retentionIsBounded() {
        assertEquals(
            AdminMessage.ValueInvalid,
            AdminSettingsValidation.validate(AdminSettingsDraft(retentionDays = "1")).retention,
        )
        assertNull(
            AdminSettingsValidation.validate(AdminSettingsDraft(retentionDays = "3650")).retention,
        )
    }

    @Test
    fun draftConversionTrimsHosts() {
        val settings =
            AdminSettingsDraft(hosts = " one.example \n\n two.example \n").toPanelSettings()

        assertEquals(listOf("one.example", "two.example"), settings?.obfuscation?.hosts)
    }

    @Test
    fun invalidDraftDoesNotConvert() {
        assertNull(AdminSettingsDraft(mtu = "nope").toPanelSettings())
    }
}
