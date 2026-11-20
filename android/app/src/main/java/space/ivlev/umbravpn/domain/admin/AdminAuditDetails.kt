package space.ivlev.umbravpn.domain.admin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import space.ivlev.umbravpn.domain.model.admin.AdminAuditField

object AdminAuditDetails {
    private val json = Json { ignoreUnknownKeys = true }
    private val sensitiveMarkers =
        listOf(
            "password",
            "passwd",
            "secret",
            "token",
            "authorization",
            "cookie",
            "private_key",
            "public_key",
            "header_protection_key",
            "hpk",
            "recovery_code",
            "totp",
            "api_key",
        )

    fun fields(details: String?): List<AdminAuditField> {
        val raw = details?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val parsed = runCatching { json.parseToJsonElement(raw) }.getOrNull()
        if (parsed == null) {
            return listOf(AdminAuditField(name = DETAILS, value = raw.take(MAX_VALUE_LENGTH)))
        }
        val output = mutableListOf<AdminAuditField>()
        flatten(parsed, prefix = null, output = output)
        return output.take(MAX_FIELDS)
    }

    fun isSensitive(name: String): Boolean {
        val normalized = name.lowercase()
        return sensitiveMarkers.any(normalized::contains)
    }

    private fun flatten(
        element: JsonElement,
        prefix: String?,
        output: MutableList<AdminAuditField>,
    ) {
        if (output.size >= MAX_FIELDS) return
        when (element) {
            is JsonObject -> {
                element.entries.forEach { (key, value) ->
                    flatten(value, prefix?.let { "$it.$key" } ?: key, output)
                }
            }
            is JsonArray -> {
                element.forEachIndexed { index, value ->
                    flatten(value, prefix?.let { "$it[$index]" } ?: "[$index]", output)
                }
            }
            is JsonPrimitive -> {
                val name = prefix ?: DETAILS
                val raw = element.content
                if (raw.isBlank()) return
                val redacted = isSensitive(name)
                output +=
                    AdminAuditField(
                        name = name,
                        value =
                            if (redacted) {
                                HIDDEN
                            } else {
                                raw.take(MAX_VALUE_LENGTH)
                            },
                        redacted = redacted,
                    )
            }
            is JsonNull -> Unit
        }
    }

    private const val DETAILS = "details"
    private const val HIDDEN = "••••••"
    private const val MAX_FIELDS = 100
    private const val MAX_VALUE_LENGTH = 2_000
}
