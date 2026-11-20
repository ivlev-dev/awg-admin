package space.ivlev.umbravpn.domain.admin

import space.ivlev.umbravpn.domain.model.admin.AdminObfuscation
import space.ivlev.umbravpn.domain.model.admin.AdminPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsDraft
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsErrors

object AdminSettingsValidation {
    const val MTU_MIN = 576
    const val MTU_MAX = 9_000
    const val S_FLOOR = 12
    const val U16_MAX = 65_535
    const val KEEPALIVE_MAX = 65_535
    const val SHARE_TTL_MIN = 60L
    const val SHARE_TTL_MAX = 2_592_000L
    const val RETENTION_MIN = 7
    const val RETENTION_MAX = 3_650

    fun validate(draft: AdminSettingsDraft): AdminSettingsErrors {
        val mtu = draft.mtu.trim().toIntOrNull()
        val jcMin = draft.jcMin.trim().toIntOrNull()
        val jcMax = draft.jcMax.trim().toIntOrNull()
        val jminMin = draft.jminMin.trim().toIntOrNull()
        val jminMax = draft.jminMax.trim().toIntOrNull()
        val jmaxMin = draft.jmaxExtraMin.trim().toIntOrNull()
        val jmaxMax = draft.jmaxExtraMax.trim().toIntOrNull()
        val sMin = draft.sMin.trim().toIntOrNull()
        val sMax = draft.sMax.trim().toIntOrNull()
        val keepaliveMin = draft.keepaliveMin.trim().toIntOrNull()
        val keepaliveMax = draft.keepaliveMax.trim().toIntOrNull()
        val shareTtl = draft.shareTtl.trim().toLongOrNull()
        val retention = draft.retentionDays.trim().toIntOrNull()

        return AdminSettingsErrors(
            mtu = rangeError(mtu, MTU_MIN, MTU_MAX),
            jc = orderedRangeError(jcMin, jcMax),
            jmin = orderedRangeError(jminMin, jminMax),
            jmax = orderedRangeError(jmaxMin, jmaxMax),
            s = sError(sMin, sMax),
            keepalive = keepaliveError(keepaliveMin, keepaliveMax),
            hosts = hostsError(draft.hostList),
            shareTtl = longRangeError(shareTtl, SHARE_TTL_MIN, SHARE_TTL_MAX),
            retention = rangeError(retention, RETENTION_MIN, RETENTION_MAX),
        )
    }

    fun hasUnsavedChanges(
        draft: AdminSettingsDraft,
        saved: AdminSettingsDraft,
    ): Boolean = draft != saved

    private fun rangeError(value: Int?, min: Int, max: Int): AdminMessage? =
        when {
            value == null -> AdminMessage.ValueInvalid
            value < min || value > max -> AdminMessage.ValueInvalid
            else -> null
        }

    private fun longRangeError(value: Long?, min: Long, max: Long): AdminMessage? =
        when {
            value == null -> AdminMessage.ValueInvalid
            value < min || value > max -> AdminMessage.ShareTtlInvalid
            else -> null
        }

    private fun orderedRangeError(low: Int?, high: Int?): AdminMessage? =
        when {
            low == null || high == null -> AdminMessage.ValueInvalid
            low < 0 || high < 0 || low > U16_MAX || high > U16_MAX -> AdminMessage.ValueInvalid
            low > high -> AdminMessage.RangeInvalid
            else -> null
        }

    private fun sError(low: Int?, high: Int?): AdminMessage? =
        when {
            low == null || high == null -> AdminMessage.ValueInvalid
            low < S_FLOOR || high < S_FLOOR || low > U16_MAX || high > U16_MAX ->
                AdminMessage.SFloor
            low > high -> AdminMessage.RangeInvalid
            else -> null
        }

    private fun keepaliveError(low: Int?, high: Int?): AdminMessage? =
        when {
            low == null || high == null -> AdminMessage.ValueInvalid
            low <= 0 || high <= 0 || low > KEEPALIVE_MAX || high > KEEPALIVE_MAX ->
                AdminMessage.KeepaliveInvalid
            low > high -> AdminMessage.KeepaliveInvalid
            else -> null
        }

    private fun hostsError(hosts: List<String>): AdminMessage? {
        if (hosts.isEmpty()) return AdminMessage.HostsRequired
        if (hosts.any { host -> host.any(Char::isWhitespace) || host.length > HOST_MAX }) {
            return AdminMessage.HostsRequired
        }
        return null
    }

    private const val HOST_MAX = 255
}

fun AdminSettingsDraft.toPanelSettings(): AdminPanelSettings? {
    if (!AdminSettingsValidation.validate(this).isValid) return null
    val obfuscation =
        AdminObfuscation(
            profile = profile,
            intensity = intensity,
            browser = browser,
            mtu = mtu.trim().toInt(),
            jcMin = jcMin.trim().toInt(),
            jcMax = jcMax.trim().toInt(),
            jminMin = jminMin.trim().toInt(),
            jminMax = jminMax.trim().toInt(),
            jmaxExtraMin = jmaxExtraMin.trim().toInt(),
            jmaxExtraMax = jmaxExtraMax.trim().toInt(),
            sMin = sMin.trim().toInt(),
            sMax = sMax.trim().toInt(),
            hosts = hostList,
            randomTrailers = randomTrailers,
            disableCookies = disableCookies,
            keepaliveMin = keepaliveMin.trim().toInt(),
            keepaliveMax = keepaliveMax.trim().toInt(),
        )
    return AdminPanelSettings(
        obfuscation = obfuscation,
        shareDefaultTtlSecs = shareTtl.trim().toLong(),
        statsRetentionDays = retentionDays.trim().toInt(),
    )
}
