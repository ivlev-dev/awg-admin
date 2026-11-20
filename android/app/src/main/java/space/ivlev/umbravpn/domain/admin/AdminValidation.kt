package space.ivlev.umbravpn.domain.admin

import kotlin.math.roundToLong

object AdminValidation {
    const val MIN_PASSWORD_LENGTH = 8
    const val FULL_NAME_MAX_LENGTH = 200
    const val GIB_BYTES = 1024.0 * 1024.0 * 1024.0

    private val emailPattern = Regex("^[^@\\s]+@[^@\\s]+$")

    fun emailError(value: String): AdminMessage? {
        val email = value.trim()
        return when {
            email.isEmpty() -> AdminMessage.EmailRequired
            !emailPattern.matches(email) -> AdminMessage.EmailInvalid
            else -> null
        }
    }

    fun optionalFullNameError(value: String): AdminMessage? =
        if (value.trim().length > FULL_NAME_MAX_LENGTH) AdminMessage.FullNameTooLong else null

    fun passwordError(value: String): AdminMessage? =
        when {
            value.isEmpty() -> AdminMessage.PasswordRequired
            value.length < MIN_PASSWORD_LENGTH -> AdminMessage.PasswordTooShort
            else -> null
        }

    fun tariffNameError(value: String): AdminMessage? =
        if (value.trim().isEmpty()) AdminMessage.NameRequired else null

    fun maxDevicesError(value: String): AdminMessage? {
        val parsed = value.trim().toIntOrNull() ?: return AdminMessage.MaxDevicesInvalid
        return if (parsed <= 0) AdminMessage.MaxDevicesInvalid else null
    }

    fun speedError(down: String, up: String): AdminMessage? {
        val downValue = down.trim().toIntOrNull() ?: return AdminMessage.SpeedInvalid
        val upValue = up.trim().toIntOrNull() ?: return AdminMessage.SpeedInvalid
        return if (downValue < 0 || upValue < 0) AdminMessage.SpeedInvalid else null
    }

    fun quotaError(value: String): AdminMessage? {
        if (value.isBlank()) return null
        val gigabytes =
            value.trim().replace(',', '.').toDoubleOrNull() ?: return AdminMessage.QuotaInvalid
        return if (gigabytes <= 0.0 || gigabytes.isInfinite() || gigabytes.isNaN()) {
            AdminMessage.QuotaInvalid
        } else {
            null
        }
    }

    fun quotaBytes(value: String): Long? {
        if (value.isBlank()) return null
        val gigabytes = value.trim().replace(',', '.').toDoubleOrNull() ?: return null
        return (gigabytes * GIB_BYTES).roundToLong().takeIf { it > 0L }
    }

    fun quotaGigabytes(bytes: Long?): String =
        if (bytes == null) {
            ""
        } else {
            val gigabytes = bytes / GIB_BYTES
            val rounded = gigabytes.roundToLong()
            if (gigabytes == rounded.toDouble()) rounded.toString() else gigabytes.toString()
        }

    fun nodeNameError(value: String): AdminMessage? =
        if (value.trim().isEmpty()) AdminMessage.NameRequired else null

    fun groupNameError(value: String): AdminMessage? =
        if (value.trim().isEmpty()) AdminMessage.NameRequired else null

    fun interfaceNameError(value: String): AdminMessage? {
        val name = value.trim()
        return if (
            name.isEmpty() ||
                name.length > INTERFACE_NAME_MAX_LENGTH ||
                !name.all { it.isLetterOrDigit() || it == '_' || it == '-' }
        ) {
            AdminMessage.InterfaceNameInvalid
        } else {
            null
        }
    }

    fun hostError(value: String): AdminMessage? {
        val host = value.trim()
        return when {
            host.isEmpty() -> AdminMessage.HostRequired
            host.any { it.isWhitespace() } -> AdminMessage.HostInvalid
            host.startsWith("-") || host.endsWith("-") -> AdminMessage.HostInvalid
            else -> null
        }
    }

    fun portError(value: String): AdminMessage? {
        val port = value.trim().toIntOrNull() ?: return AdminMessage.PortInvalid
        return if (port in MIN_PORT..MAX_PORT) null else AdminMessage.PortInvalid
    }

    fun mtuError(value: String): AdminMessage? {
        val mtu = value.trim().toIntOrNull() ?: return AdminMessage.MtuInvalid
        return if (mtu in MIN_MTU..MAX_MTU) null else AdminMessage.MtuInvalid
    }

    fun cidrError(value: String): AdminMessage? {
        val parts = value.trim().split('/')
        if (parts.size != 2) return AdminMessage.CidrInvalid
        if (!isIpv4(parts[0])) return AdminMessage.CidrInvalid
        val prefix = parts[1].toIntOrNull() ?: return AdminMessage.CidrInvalid
        return if (prefix in 0..MAX_IPV4_PREFIX) null else AdminMessage.CidrInvalid
    }

    fun gatewayError(value: String): AdminMessage? {
        if (value.isBlank()) return null
        return if (isIpv4(value.trim())) null else AdminMessage.GatewayInvalid
    }

    fun nodeSelectionError(nodeId: String?): AdminMessage? =
        if (nodeId.isNullOrBlank()) AdminMessage.NodeRequired else null

    fun groupSelectionError(groupId: String?): AdminMessage? =
        if (groupId.isNullOrBlank()) AdminMessage.GroupRequired else null

    fun isIpv4(value: String): Boolean {
        val parts = value.split('.')
        if (parts.size != IPV4_PARTS) return false
        return parts.all { part ->
            part.isNotEmpty() &&
                part.length <= 3 &&
                part.all(Char::isDigit) &&
                part.toIntOrNull()?.let { it in 0..MAX_OCTET } == true
        }
    }

    private const val INTERFACE_NAME_MAX_LENGTH = 15
    private const val MIN_PORT = 1
    private const val MAX_PORT = 65_535
    private const val MIN_MTU = 576
    private const val MAX_MTU = 9_000
    private const val MAX_IPV4_PREFIX = 32
    private const val IPV4_PARTS = 4
    private const val MAX_OCTET = 255
}
