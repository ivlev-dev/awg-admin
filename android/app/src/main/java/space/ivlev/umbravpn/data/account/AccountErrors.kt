package space.ivlev.umbravpn.data.account

import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import space.ivlev.umbravpn.domain.model.account.AccountError

internal data class ErrorPayload(val code: String?, val message: String?)

internal fun parseErrorPayload(body: String): ErrorPayload {
    val root =
        runCatching { Json.parseToJsonElement(body).jsonObject }.getOrNull()
            ?: return ErrorPayload(null, null)
    val nested = root["error"] as? JsonObject
    if (nested != null) {
        return ErrorPayload(
            code = nested.stringOrNull("code"),
            message = nested.stringOrNull("message"),
        )
    }
    return ErrorPayload(
        code = (root["error"] as? JsonPrimitive)?.contentOrNull(),
        message = root.stringOrNull("message"),
    )
}

private fun JsonObject.stringOrNull(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull()?.takeIf { it.isNotBlank() }

private fun JsonPrimitive.contentOrNull(): String? = runCatching {
    content
}
    .getOrNull()
    ?.takeIf { it.isNotBlank() }

internal fun mapApiError(status: Int, body: String): AccountError {
    val payload = parseErrorPayload(body)
    val code = payload.code ?: "http_$status"
    val message = payload.message ?: "HTTP $status"
    return when (status) {
        HttpStatusCode.Unauthorized.value ->
            if (code == CODE_TOTP_REQUIRED || code == CODE_TOTP_INVALID) {
                AccountError.Api(status, code, message)
            } else {
                AccountError.Unauthorized
            }
        else -> AccountError.Api(status, code, message)
    }
}

internal const val CODE_TOTP_REQUIRED = "totp_required"
internal const val CODE_TOTP_INVALID = "totp_invalid"
internal const val CODE_EMAIL_NOT_VERIFIED = "email_not_verified"
internal const val CODE_PENDING_APPROVAL = "pending_approval"
