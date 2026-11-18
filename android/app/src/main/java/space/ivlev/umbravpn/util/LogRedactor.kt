package space.ivlev.umbravpn.util

/**
 * Removes secrets from log messages. Release logs keep warnings and errors, but never private keys,
 * tokens or passwords, and stack traces are not written at all.
 */
object LogRedactor {
    private const val REDACTED = "[redacted]"

    private val patterns =
        listOf(
            Regex(
                "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
                RegexOption.IGNORE_CASE,
            ),
            Regex(
                "(?i)(private[_ ]?key|preshared[_ ]?key|psk|password|passwd|token|access[_ ]?token|refresh[_ ]?token|authorization|secret)(\\s*[=:]\\s*)([^\\s,;]+)",
            ),
            // WireGuard keys are 44 character base64 values; any long base64 blob is suspicious.
            Regex("[A-Za-z0-9+/]{40,}={0,2}"),
        )

    fun redact(message: String): String {
        var result = message
        result = patterns[0].replace(result) { REDACTED }
        result =
            patterns[1].replace(result) { match ->
                "${match.groupValues[1]}${match.groupValues[2]}$REDACTED"
            }
        result = patterns[2].replace(result) { REDACTED }
        return result
    }
}
