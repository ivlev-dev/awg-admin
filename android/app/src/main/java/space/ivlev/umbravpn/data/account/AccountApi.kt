package space.ivlev.umbravpn.data.account

import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.StoredSession
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository

class AccountApi(
    private val client: HttpClient,
    private val json: Json,
    private val sessionManager: SessionManager,
    private val settings: AccountSettingsRepository,
    private val nowEpochSeconds: () -> Long = { Instant.now().epochSecond },
) {
    private val refreshMutex = Mutex()

    suspend fun login(
        login: String,
        password: String,
        totpCode: String? = null,
    ): AccountResult<AuthUser> {
        val result =
            execute(
                authenticated = false,
                send = { baseUrl, _ ->
                    client.post(endpoint(baseUrl, "auth/login")) {
                        contentType(ContentType.Application.Json)
                        setBody(
                            LoginRequestDto(
                                login = login,
                                password = password,
                                totpCode = totpCode?.takeIf { it.isNotBlank() },
                            ),
                        )
                    }
                },
                decode = { body -> json.decodeFromString<AuthResponseDto>(body) },
            )
        return when (result) {
            is AccountResult.Success -> {
                persist(result.value)
                AccountResult.Success(result.value.user.toDomain())
            }
            is AccountResult.Failure -> {
                applyAuthFailure(result.error, login)
                result
            }
        }
    }

    suspend fun register(email: String, password: String): AccountResult<Unit> {
        val result =
            executeUnit(authenticated = false) { baseUrl, _ ->
                client.post(endpoint(baseUrl, "auth/register")) {
                    contentType(ContentType.Application.Json)
                    setBody(RegisterRequestDto(email = email, password = password))
                }
            }
        if (result is AccountResult.Success) sessionManager.markPendingEmail()
        return result
    }

    suspend fun verifyEmail(token: String): AccountResult<Unit> {
        val result =
            executeUnit(authenticated = false) { baseUrl, _ ->
                client.post(endpoint(baseUrl, "auth/verify-email")) {
                    contentType(ContentType.Application.Json)
                    setBody(VerifyEmailRequestDto(token = token))
                }
            }
        if (result is AccountResult.Success) sessionManager.markPendingApproval()
        return result
    }

    suspend fun resendVerification(email: String): AccountResult<Unit> =
        executeUnit(authenticated = false) { baseUrl, _ ->
            client.post(endpoint(baseUrl, "auth/resend-verification")) {
                contentType(ContentType.Application.Json)
                setBody(ResendVerificationRequestDto(email = email))
            }
        }

    suspend fun forgotPassword(email: String): AccountResult<Unit> =
        executeUnit(authenticated = false) { baseUrl, _ ->
            client.post(endpoint(baseUrl, "auth/forgot-password")) {
                contentType(ContentType.Application.Json)
                setBody(ForgotPasswordRequestDto(email = email))
            }
        }

    suspend fun resetPassword(token: String, password: String): AccountResult<Unit> =
        executeUnit(authenticated = false) { baseUrl, _ ->
            client.post(endpoint(baseUrl, "auth/reset-password")) {
                contentType(ContentType.Application.Json)
                setBody(ResetPasswordRequestDto(token = token, password = password))
            }
        }

    suspend fun logout(): AccountResult<Unit> {
        val refreshToken = sessionManager.currentSession()?.refreshToken
        val result =
            if (refreshToken == null) {
                AccountResult.Success(Unit)
            } else {
                executeUnit(authenticated = false) { baseUrl, _ ->
                    client.post(endpoint(baseUrl, "auth/logout")) {
                        contentType(ContentType.Application.Json)
                        setBody(LogoutRequestDto(refreshToken = refreshToken))
                    }
                }
            }
        sessionManager.markLoggedOut()
        return result
    }

    suspend fun me(): AccountResult<AuthUser> {
        val result =
            execute(
                authenticated = true,
                send = { baseUrl, token ->
                    client.get(endpoint(baseUrl, "auth/me")) { bearer(token) }
                },
                decode = { body -> json.decodeFromString<UserDto>(body) },
            )
        return when (result) {
            is AccountResult.Success -> {
                val user = result.value.toDomain()
                sessionManager.onUserUpdated(user)
                AccountResult.Success(user)
            }
            is AccountResult.Failure -> {
                applyAuthFailure(result.error)
                result
            }
        }
    }

    suspend fun bootstrap(): AccountResult<AccountSnapshot> {
        val result =
            execute(
                authenticated = true,
                send = { baseUrl, token ->
                    client.get(endpoint(baseUrl, "app/bootstrap")) { bearer(token) }
                },
                decode = { body -> json.decodeFromString<BootstrapDto>(body).toDomain() },
            )
        if (result is AccountResult.Failure) applyAuthFailure(result.error)
        return result
    }

    suspend fun createDevice(name: String): AccountResult<CreatedDevice> =
        execute(
            authenticated = true,
            send = { baseUrl, token ->
                client.post(endpoint(baseUrl, "app/devices")) {
                    bearer(token)
                    contentType(ContentType.Application.Json)
                    setBody(CreateDeviceRequestDto(name = name))
                }
            },
            decode = { body -> json.decodeFromString<AppDeviceDto>(body).toDomain() },
        )

    suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> =
        execute(
            authenticated = true,
            send = { baseUrl, token ->
                client.get(endpoint(baseUrl, "app/devices/$id/config")) { bearer(token) }
            },
            decode = { body -> json.decodeFromString<DeviceConfigDto>(body).toDomain() },
        )

    suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> =
        execute(
            authenticated = true,
            send = { baseUrl, token ->
                client.patch(endpoint(baseUrl, "app/devices/$id")) {
                    bearer(token)
                    contentType(ContentType.Application.Json)
                    setBody(RenameDeviceRequestDto(name = name))
                }
            },
            decode = { body -> json.decodeFromString<DeviceDto>(body).toDomain() },
        )

    suspend fun deleteDevice(id: String): AccountResult<Unit> =
        executeUnit(authenticated = true) { baseUrl, token ->
            client.delete(endpoint(baseUrl, "app/devices/$id")) { bearer(token) }
        }

    private fun persist(auth: AuthResponseDto) {
        sessionManager.onAuthenticated(
            session =
                StoredSession(
                    accessToken = auth.token,
                    refreshToken = auth.refreshToken,
                    expiresAtEpochSeconds = nowEpochSeconds() + auth.expiresIn,
                    userId = auth.user.id,
                    email = auth.user.email,
                ),
            user = auth.user.toDomain(),
        )
    }

    private fun applyAuthFailure(error: AccountError, email: String? = null) {
        val blockedEmail = email ?: sessionManager.currentSession()?.email
        when (error) {
            is AccountError.Disabled -> sessionManager.markBlocked(error.reason, blockedEmail)
            is AccountError.Api ->
                when (error.code) {
                    CODE_EMAIL_NOT_VERIFIED -> sessionManager.markPendingEmail()
                    CODE_PENDING_APPROVAL -> sessionManager.markPendingApproval()
                    CODE_ACCOUNT_DISABLED ->
                        sessionManager.markBlocked(BlockReason.Disabled, blockedEmail)
                    CODE_REJECTED -> sessionManager.markBlocked(BlockReason.Rejected, blockedEmail)
                }
            AccountError.TariffRequired,
            AccountError.SubscriptionInactive,
            AccountError.Network,
            AccountError.SessionExpired,
            AccountError.Unauthorized,
            AccountError.ServerNotConfigured,
            is AccountError.Unexpected -> Unit
        }
    }

    private suspend fun executeUnit(
        authenticated: Boolean,
        send: suspend (baseUrl: String, accessToken: String?) -> HttpResponse,
    ): AccountResult<Unit> = execute(authenticated = authenticated, send = send, decode = {})

    private suspend fun <T> execute(
        authenticated: Boolean,
        send: suspend (baseUrl: String, accessToken: String?) -> HttpResponse,
        decode: suspend (body: String) -> T,
    ): AccountResult<T> {
        val baseUrl = settings.serverUrl()
        if (baseUrl.isBlank()) {
            return AccountResult.Failure(AccountError.ServerNotConfigured)
        }

        val accessToken =
            if (authenticated) {
                val session = sessionManager.currentSession()
                if (session == null) {
                    sessionManager.markExpired()
                    return AccountResult.Failure(AccountError.SessionExpired)
                }
                session.accessToken
            } else {
                null
            }

        val first =
            sendOrNetwork(baseUrl, accessToken, send)
                ?: return AccountResult.Failure(AccountError.Network)

        if (authenticated && first.status == HttpStatusCode.Unauthorized) {
            val failedToken =
                accessToken ?: return AccountResult.Failure(AccountError.SessionExpired)
            return when (val outcome = refresh(baseUrl, failedToken)) {
                RefreshOutcome.Expired -> {
                    sessionManager.markExpired()
                    AccountResult.Failure(AccountError.SessionExpired)
                }
                RefreshOutcome.NetworkFailure -> AccountResult.Failure(AccountError.Network)
                is RefreshOutcome.Refreshed -> {
                    val retry =
                        sendOrNetwork(baseUrl, outcome.accessToken, send)
                            ?: return AccountResult.Failure(AccountError.Network)
                    if (retry.status == HttpStatusCode.Unauthorized) {
                        sessionManager.markExpired()
                        return AccountResult.Failure(AccountError.SessionExpired)
                    }
                    parse(retry, decode)
                }
            }
        }

        return parse(first, decode)
    }

    private suspend fun refresh(baseUrl: String, failedAccessToken: String): RefreshOutcome =
        refreshMutex.withLock {
            val stored = sessionManager.currentSession() ?: return@withLock RefreshOutcome.Expired
            if (stored.accessToken != failedAccessToken) {
                return@withLock RefreshOutcome.Refreshed(stored.accessToken)
            }
            if (stored.refreshToken.isBlank()) {
                return@withLock RefreshOutcome.Expired
            }

            val response =
                try {
                    client.post(endpoint(baseUrl, "auth/refresh")) {
                        contentType(ContentType.Application.Json)
                        setBody(RefreshRequestDto(refreshToken = stored.refreshToken))
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    return@withLock RefreshOutcome.NetworkFailure
                }

            val body =
                try {
                    response.bodyAsText()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    return@withLock RefreshOutcome.NetworkFailure
                }

            if (!response.status.isSuccess()) {
                val status = response.status.value
                val expired = status == 400 || status == 401 || status == 403
                return@withLock if (expired) RefreshOutcome.Expired
                else RefreshOutcome.NetworkFailure
            }

            val auth =
                runCatching { json.decodeFromString<AuthResponseDto>(body) }.getOrNull()
                    ?: return@withLock RefreshOutcome.Expired
            persist(auth)
            RefreshOutcome.Refreshed(auth.token)
        }

    private suspend fun sendOrNetwork(
        baseUrl: String,
        accessToken: String?,
        send: suspend (baseUrl: String, accessToken: String?) -> HttpResponse,
    ): HttpResponse? =
        try {
            send(baseUrl, accessToken)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }

    private suspend fun <T> parse(
        response: HttpResponse,
        decode: suspend (body: String) -> T,
    ): AccountResult<T> {
        val body =
            try {
                response.bodyAsText()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return AccountResult.Failure(AccountError.Network)
            }

        if (!response.status.isSuccess()) {
            return AccountResult.Failure(mapApiError(response.status.value, body))
        }

        return try {
            AccountResult.Success(decode(body))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AccountResult.Failure(AccountError.Unexpected(e.message))
        }
    }

    private sealed interface RefreshOutcome {
        data class Refreshed(val accessToken: String) : RefreshOutcome

        data object Expired : RefreshOutcome

        data object NetworkFailure : RefreshOutcome
    }
}

private fun endpoint(baseUrl: String, path: String): String = "$baseUrl/api/v1/$path"

private fun HttpRequestBuilder.bearer(token: String?) {
    if (!token.isNullOrBlank()) {
        header(HttpHeaders.Authorization, "Bearer $token")
    }
}
