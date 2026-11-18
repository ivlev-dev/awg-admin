package space.ivlev.umbravpn.data.account

import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import java.time.Instant
import java.util.UUID
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
                method = HttpMethod.Post,
                path = "auth/login",
                configure = {
                    contentType(ContentType.Application.Json)
                    setBody(
                        LoginRequestDto(
                            login = login,
                            password = password,
                            totpCode = totpCode?.takeIf { it.isNotBlank() },
                        ),
                    )
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
            executeUnit(
                authenticated = false,
                method = HttpMethod.Post,
                path = "auth/register",
            ) {
                contentType(ContentType.Application.Json)
                setBody(RegisterRequestDto(email = email, password = password))
            }
        if (result is AccountResult.Success) sessionManager.markPendingEmail()
        return result
    }

    suspend fun verifyEmail(token: String): AccountResult<Unit> {
        val result =
            executeUnit(
                authenticated = false,
                method = HttpMethod.Post,
                path = "auth/verify-email",
            ) {
                contentType(ContentType.Application.Json)
                setBody(VerifyEmailRequestDto(token = token))
            }
        if (result is AccountResult.Success) sessionManager.markPendingApproval()
        return result
    }

    suspend fun resendVerification(email: String): AccountResult<Unit> =
        executeUnit(
            authenticated = false,
            method = HttpMethod.Post,
            path = "auth/resend-verification",
        ) {
            contentType(ContentType.Application.Json)
            setBody(ResendVerificationRequestDto(email = email))
        }

    suspend fun forgotPassword(email: String): AccountResult<Unit> =
        executeUnit(
            authenticated = false,
            method = HttpMethod.Post,
            path = "auth/forgot-password",
        ) {
            contentType(ContentType.Application.Json)
            setBody(ForgotPasswordRequestDto(email = email))
        }

    suspend fun resetPassword(token: String, password: String): AccountResult<Unit> =
        executeUnit(
            authenticated = false,
            method = HttpMethod.Post,
            path = "auth/reset-password",
        ) {
            contentType(ContentType.Application.Json)
            setBody(ResetPasswordRequestDto(token = token, password = password))
        }

    suspend fun logout(): AccountResult<Unit> {
        val refreshToken = sessionManager.currentSession()?.refreshToken
        val result =
            if (refreshToken == null) {
                AccountResult.Success(Unit)
            } else {
                executeUnit(
                    authenticated = false,
                    method = HttpMethod.Post,
                    path = "auth/logout",
                ) {
                    contentType(ContentType.Application.Json)
                    setBody(LogoutRequestDto(refreshToken = refreshToken))
                }
            }
        sessionManager.markLoggedOut()
        return result
    }

    suspend fun me(): AccountResult<AuthUser> {
        val result =
            execute(
                authenticated = true,
                method = HttpMethod.Get,
                path = "auth/me",
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
                method = HttpMethod.Get,
                path = "app/bootstrap",
                decode = { body -> json.decodeFromString<BootstrapDto>(body).toDomain() },
            )
        if (result is AccountResult.Failure) applyAuthFailure(result.error)
        return result
    }

    suspend fun createDevice(
        name: String,
        interfaceIds: List<String> = emptyList(),
        idempotencyKey: String? = null,
    ): AccountResult<CreatedDevice> =
        execute(
            authenticated = true,
            method = HttpMethod.Post,
            path = "app/devices",
            idempotencyKey = idempotencyKey,
            configure = {
                contentType(ContentType.Application.Json)
                setBody(
                    CreateDeviceRequestDto(
                        name = name,
                        interfaceIds = interfaceIds.takeIf { it.isNotEmpty() },
                    ),
                )
            },
            decode = { body -> json.decodeFromString<AppDeviceDto>(body).toDomain() },
        )

    suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> =
        execute(
            authenticated = true,
            method = HttpMethod.Get,
            path = "app/devices/$id/config",
            decode = { body -> json.decodeFromString<DeviceConfigDto>(body).toDomain() },
        )

    suspend fun deviceConfigs(id: String): AccountResult<List<DeviceConfig>> =
        execute(
            authenticated = true,
            method = HttpMethod.Get,
            path = "app/devices/$id/configs",
            decode = { body ->
                json.decodeFromString<List<DeviceConfigDto>>(body).map(DeviceConfigDto::toDomain)
            },
        )

    suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> =
        execute(
            authenticated = true,
            method = HttpMethod.Patch,
            path = "app/devices/$id",
            configure = {
                contentType(ContentType.Application.Json)
                setBody(RenameDeviceRequestDto(name = name))
            },
            decode = { body -> json.decodeFromString<DeviceDto>(body).toDomain() },
        )

    suspend fun deleteDevice(id: String): AccountResult<Unit> =
        executeUnit(
            authenticated = true,
            method = HttpMethod.Delete,
            path = "app/devices/$id",
        )

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
        method: HttpMethod,
        path: String,
        idempotencyKey: String? = null,
        configure: HttpRequestBuilder.() -> Unit = {},
    ): AccountResult<Unit> =
        execute(
            authenticated = authenticated,
            method = method,
            path = path,
            idempotencyKey = idempotencyKey,
            configure = configure,
            decode = {},
        )

    private suspend fun <T> execute(
        authenticated: Boolean,
        method: HttpMethod,
        path: String,
        idempotencyKey: String? = null,
        configure: HttpRequestBuilder.() -> Unit = {},
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

        val requestKey = idempotencyKeyFor(method, path, idempotencyKey)

        suspend fun send(token: String?): HttpResponse? =
            sendOrNetwork(baseUrl, method, path, token, requestKey, configure)

        val first = send(accessToken) ?: return AccountResult.Failure(AccountError.Network)

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
                        send(outcome.accessToken)
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
        method: HttpMethod,
        path: String,
        accessToken: String?,
        idempotencyKey: String?,
        configure: HttpRequestBuilder.() -> Unit,
    ): HttpResponse? =
        try {
            client.request(endpoint(baseUrl, path)) {
                this.method = method
                bearer(accessToken)
                if (!idempotencyKey.isNullOrBlank()) {
                    header(IDEMPOTENCY_KEY_HEADER, idempotencyKey)
                }
                configure()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }

    private fun idempotencyKeyFor(
        method: HttpMethod,
        path: String,
        explicitKey: String?,
    ): String? =
        when {
            method != HttpMethod.Post -> null
            !path.startsWith(APP_PATH_PREFIX) -> null
            !explicitKey.isNullOrBlank() -> explicitKey
            else -> UUID.randomUUID().toString()
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

private const val APP_PATH_PREFIX = "app/"

private fun endpoint(baseUrl: String, path: String): String = "$baseUrl/api/v1/$path"

private fun HttpRequestBuilder.bearer(token: String?) {
    if (!token.isNullOrBlank()) {
        header(HttpHeaders.Authorization, "Bearer $token")
    }
}
