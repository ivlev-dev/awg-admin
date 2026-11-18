package space.ivlev.umbravpn.util.network

import java.net.URI

fun normalizeServerUrl(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ""

    val withScheme = if (trimmed.contains("://")) trimmed else "https://$trimmed"
    val normalized = withScheme.trimEnd('/')
    val authority = normalized.substringAfter("://", missingDelimiterValue = "")
    return if (authority.isBlank()) "" else normalized
}

enum class ServerUrlError {
    Empty,
    InvalidFormat,
    UnsupportedScheme,
    MissingHost,
    InsecureScheme,
    UserInfoNotAllowed,
    FragmentNotAllowed,
}

sealed interface ServerUrlValidation {
    data class Valid(val url: String) : ServerUrlValidation

    data class Invalid(val error: ServerUrlError) : ServerUrlValidation
}

/**
 * Validates a panel URL. Release builds must not talk to plain HTTP servers, and credentials or
 * fragments in the URL are rejected so they do not leak into logs or HTTP requests.
 */
fun validateServerUrl(raw: String, allowHttp: Boolean = false): ServerUrlValidation {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ServerUrlValidation.Invalid(ServerUrlError.Empty)
    if (trimmed.any { it.isWhitespace() }) {
        return ServerUrlValidation.Invalid(ServerUrlError.InvalidFormat)
    }

    if (trimmed.contains("://")) {
        val scheme = trimmed.substringBefore("://").lowercase()
        if (scheme != "http" && scheme != "https") {
            return ServerUrlValidation.Invalid(ServerUrlError.UnsupportedScheme)
        }
        if (scheme == "http" && !allowHttp) {
            return ServerUrlValidation.Invalid(ServerUrlError.InsecureScheme)
        }
    }

    val normalized = normalizeServerUrl(trimmed)
    if (normalized.isEmpty()) return ServerUrlValidation.Invalid(ServerUrlError.MissingHost)

    val uri =
        runCatching { URI(normalized) }.getOrNull()
            ?: return ServerUrlValidation.Invalid(ServerUrlError.InvalidFormat)

    if (uri.scheme != "http" && uri.scheme != "https") {
        return ServerUrlValidation.Invalid(ServerUrlError.UnsupportedScheme)
    }
    if (uri.scheme == "http" && !allowHttp) {
        return ServerUrlValidation.Invalid(ServerUrlError.InsecureScheme)
    }
    if (uri.host.isNullOrBlank()) return ServerUrlValidation.Invalid(ServerUrlError.MissingHost)
    if (uri.userInfo != null) {
        return ServerUrlValidation.Invalid(ServerUrlError.UserInfoNotAllowed)
    }
    if (uri.fragment != null) {
        return ServerUrlValidation.Invalid(ServerUrlError.FragmentNotAllowed)
    }
    return ServerUrlValidation.Valid(normalized)
}
