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
}

sealed interface ServerUrlValidation {
    data class Valid(val url: String) : ServerUrlValidation

    data class Invalid(val error: ServerUrlError) : ServerUrlValidation
}

fun validateServerUrl(raw: String): ServerUrlValidation {
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
    }

    val normalized = normalizeServerUrl(trimmed)
    if (normalized.isEmpty()) return ServerUrlValidation.Invalid(ServerUrlError.MissingHost)

    val uri =
        runCatching { URI(normalized) }.getOrNull()
            ?: return ServerUrlValidation.Invalid(ServerUrlError.InvalidFormat)

    if (uri.scheme != "http" && uri.scheme != "https") {
        return ServerUrlValidation.Invalid(ServerUrlError.UnsupportedScheme)
    }
    if (uri.host.isNullOrBlank()) return ServerUrlValidation.Invalid(ServerUrlError.MissingHost)
    return ServerUrlValidation.Valid(normalized)
}
