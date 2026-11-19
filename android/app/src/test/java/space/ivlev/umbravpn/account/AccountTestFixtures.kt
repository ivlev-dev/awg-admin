package space.ivlev.umbravpn.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import space.ivlev.umbravpn.data.account.AccountApi
import space.ivlev.umbravpn.data.account.SessionManager
import space.ivlev.umbravpn.data.repository.KtorAccountRepository
import space.ivlev.umbravpn.data.repository.KtorAuthRepository
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.StoredSession
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.security.TokenStore
import space.ivlev.umbravpn.util.network.normalizeServerUrl

internal const val TEST_SERVER_URL = "https://panel.test"

internal val testJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

internal class InMemoryTokenStore(initial: StoredSession? = null) : TokenStore {
    var session: StoredSession? = initial
        private set

    override fun load(): StoredSession? = session

    override fun save(session: StoredSession) {
        this.session = session
    }

    override fun clear() {
        session = null
    }
}

internal class FakeAccountSettingsRepository(rawUrl: String = TEST_SERVER_URL) :
    AccountSettingsRepository {
    private val urlState = MutableStateFlow(normalizeServerUrl(rawUrl))
    private val termsState = MutableStateFlow(false)
    private val managedProvisionedState = MutableStateFlow(false)
    var cachedSnapshotState: String? = null
    private val manualDisconnectState = MutableStateFlow(false)
    private val autoConnectOnStartupState = MutableStateFlow(true)

    override val serverUrlFlow: Flow<String> = urlState

    override val termsAcceptedFlow: Flow<Boolean> = termsState

    override suspend fun serverUrl(): String = urlState.value

    override suspend fun setServerUrl(url: String) {
        urlState.value = normalizeServerUrl(url)
    }

    override suspend fun termsAccepted(): Boolean = termsState.value

    override suspend fun setTermsAccepted(accepted: Boolean) {
        termsState.value = accepted
    }

    override suspend fun managedProvisioned(): Boolean = managedProvisionedState.value

    override suspend fun setManagedProvisioned(provisioned: Boolean) {
        managedProvisionedState.value = provisioned
    }

    override suspend fun cachedSnapshot(): String? = cachedSnapshotState

    override suspend fun setCachedSnapshot(json: String?) {
        cachedSnapshotState = json
    }

    override suspend fun manualDisconnect(): Boolean = manualDisconnectState.value

    override suspend fun setManualDisconnect(value: Boolean) {
        manualDisconnectState.value = value
    }

    override suspend fun autoConnectOnStartup(): Boolean = autoConnectOnStartupState.value

    override suspend fun setAutoConnectOnStartup(enabled: Boolean) {
        autoConnectOnStartupState.value = enabled
    }
}

internal class AccountTestEnvironment(
    val engine: MockEngine,
    val tokenStore: InMemoryTokenStore,
    val sessionManager: SessionManager,
    val settings: FakeAccountSettingsRepository,
    val authRepository: AuthRepository,
    val accountRepository: AccountRepository,
) {
    val requests: List<HttpRequestData>
        get() = engine.requestHistory
}

internal fun createEnvironment(
    initialSession: StoredSession? = null,
    rawServerUrl: String = TEST_SERVER_URL,
    nowEpochSeconds: Long = 1_700_000_000L,
    handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
): AccountTestEnvironment {
    val engine = MockEngine { request -> handler(request) }
    val client =
        HttpClient(engine) {
            install(ContentNegotiation) { json(testJson) }
            expectSuccess = false
        }
    val tokenStore = InMemoryTokenStore(initialSession)
    val sessionManager = SessionManager(tokenStore)
    val settings = FakeAccountSettingsRepository(rawServerUrl)
    val api =
        AccountApi(
            client = client,
            json = testJson,
            sessionManager = sessionManager,
            settings = settings,
            nowEpochSeconds = { nowEpochSeconds },
        )
    return AccountTestEnvironment(
        engine = engine,
        tokenStore = tokenStore,
        sessionManager = sessionManager,
        settings = settings,
        authRepository = KtorAuthRepository(api, sessionManager),
        accountRepository = KtorAccountRepository(api),
    )
}

internal fun MockRequestHandleScope.jsonResponse(
    status: HttpStatusCode,
    body: String,
): HttpResponseData = respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

internal fun MockRequestHandleScope.emptyResponse(status: HttpStatusCode): HttpResponseData =
    respond("", status, headersOf(HttpHeaders.ContentType, "application/json"))

internal fun errorBody(code: String, message: String): String =
    """{"error":{"code":"$code","message":"$message"}}"""

internal fun <T> AccountResult<T>.requireSuccess(): T =
    when (this) {
        is AccountResult.Success -> value
        is AccountResult.Failure -> throw AssertionError("expected success, got failure: $error")
    }

internal fun <T> AccountResult<T>.requireFailure(): AccountError =
    when (this) {
        is AccountResult.Success -> throw AssertionError("expected failure, got success: $value")
        is AccountResult.Failure -> error
    }

internal fun storedSession(
    accessToken: String = "access-1",
    refreshToken: String = "refresh-1",
    expiresAtEpochSeconds: Long = 1_700_003_600L,
): StoredSession =
    StoredSession(
        accessToken = accessToken,
        refreshToken = refreshToken,
        expiresAtEpochSeconds = expiresAtEpochSeconds,
        userId = "user-1",
        email = "alice@example.com",
    )

internal fun authJson(
    token: String = "access-1",
    refreshToken: String = "refresh-1",
    expiresIn: Long = 3600L,
): String =
    """
    {
      "token": "$token",
      "refresh_token": "$refreshToken",
      "expires_in": $expiresIn,
      "user": {
        "id": "user-1",
        "login": "alice",
        "email": "alice@example.com",
        "status": "active",
        "totp_enabled": true,
        "role": "user",
        "tariff_id": "tariff-1",
        "group_id": null,
        "node_id": "node-1",
        "disabled": false,
        "created_at": "2026-01-01T10:00:00Z",
        "updated_at": "2026-01-02T11:30:00Z"
      }
    }
    """
        .trimIndent()

internal fun appDeviceWithConfigsJson(deviceName: String = "Pixel"): String =
    """
    {
      "device": {
        "id": "device-1",
        "user_id": "user-1",
        "group_id": "group-1",
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "node_name": "Frankfurt",
        "name": "$deviceName",
        "down_kbps": 0,
        "up_kbps": 0,
        "revoked": false,
        "external": false,
        "created_at": "2026-01-03T09:00:00Z",
        "peers": [
          {
            "interface_id": "iface-1",
            "interface_name": "awg0",
            "public_key": "peer-key-1",
            "addresses": ["10.8.0.2/32"]
          },
          {
            "interface_id": "iface-2",
            "interface_name": "awg1",
            "public_key": "peer-key-2",
            "addresses": ["10.9.0.2/32"]
          }
        ],
        "addresses": ["10.8.0.2/32"]
      },
      "config": {
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "endpoint": "vpn.example.com:51820",
        "addresses": ["10.8.0.2/32"],
        "conf": "[Interface]\nPrivateKey = secret\n",
        "revision": "0123456789abcdef"
      },
      "configs": [
        {
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "node_id": "node-1",
          "endpoint": "vpn.example.com:51820",
          "addresses": ["10.8.0.2/32"],
          "conf": "[Interface]\nPrivateKey = secret\n",
          "revision": "0123456789abcdef"
        },
        {
          "interface_id": "iface-2",
          "interface_name": "awg1",
          "node_id": "node-2",
          "endpoint": "ams.example.com:51820",
          "addresses": ["10.9.0.2/32"],
          "conf": "[Interface]\nPrivateKey = second-secret\n",
          "revision": "fedcba9876543210"
        }
      ]
    }
    """
        .trimIndent()

internal fun bootstrapJson(): String =
    """
    {
      "user": {
        "id": "user-1",
        "login": "alice",
        "email": "alice@example.com",
        "status": "active",
        "totp_enabled": false,
        "role": "user",
        "tariff_id": "tariff-1",
        "group_id": null,
        "node_id": "node-1",
        "disabled": false,
        "created_at": "2026-01-01T10:00:00Z",
        "updated_at": "2026-01-02T11:30:00Z"
      },
      "tariff": {
        "id": "tariff-1",
        "name": "Standard",
        "description": "5 devices",
        "max_devices": 5,
        "device_down_kbps": 100000,
        "device_up_kbps": 50000,
        "traffic_quota_bytes": 107374182400
      },
      "quota": {
        "used_bytes": 5368709120,
        "quota_bytes": 107374182400,
        "exceeded": false,
        "remaining_bytes": 102005473280,
        "percent": 5.0,
        "period_start": "2026-01-01T00:00:00Z",
        "period_end": "2026-02-01T00:00:00Z",
        "reset_at": "2026-02-01T00:00:00Z"
      },
      "devices": [
        {
          "id": "device-1",
          "user_id": "user-1",
          "group_id": "group-1",
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "node_id": "node-1",
          "node_name": "Frankfurt",
          "name": "Pixel",
          "down_kbps": 0,
          "up_kbps": 0,
          "forwarding": {"to_own_devices": true, "allowed_devices": []},
          "revoked": false,
          "external": false,
          "created_at": "2026-01-03T09:00:00Z",
          "peers": [
            {
              "interface_id": "iface-1",
              "interface_name": "awg0",
              "public_key": "peer-key-1",
              "addresses": ["10.8.0.2/32"]
            },
            {
              "interface_id": "iface-2",
              "interface_name": "awg1",
              "public_key": "peer-key-2",
              "addresses": ["10.9.0.2/32"]
            }
          ],
          "addresses": ["10.8.0.2/32"]
        }
      ],
      "interfaces": [
        {
          "id": "iface-1",
          "name": "awg0",
          "node_id": "node-1",
          "node_name": "Frankfurt"
        },
        {
          "id": "iface-2",
          "name": "awg1",
          "node_id": "node-2",
          "node_name": "Amsterdam"
        }
      ]
    }
    """
        .trimIndent()

internal fun bootstrapWithSubscriptionJson(
    subscriptionStatus: String = "active",
    grantsAccess: Boolean = true,
    blocked: Boolean = false,
    throttled: Boolean = false,
    reasons: List<String> = emptyList(),
): String {
    val reasonsJson = reasons.joinToString(",") { "\"$it\"" }
    return """
    {
      "user": {
        "id": "user-1",
        "login": "alice",
        "email": "alice@example.com",
        "status": "active",
        "totp_enabled": false,
        "role": "user",
        "disabled": false,
        "created_at": "2026-01-01T10:00:00Z",
        "updated_at": "2026-01-02T11:30:00Z"
      },
      "tariff": null,
      "quota": {
        "used_bytes": 0,
        "quota_bytes": null,
        "exceeded": $throttled,
        "remaining_bytes": null,
        "percent": null,
        "period_start": null,
        "period_end": null,
        "reset_at": "2026-03-01T00:00:00Z"
      },
      "devices": [],
      "subscription": {
        "id": "sub-1",
        "plan_name": "Umbra Plus",
        "status": "$subscriptionStatus",
        "current_period_end": "2026-03-01T00:00:00Z",
        "auto_renew": true,
        "cancel_at_period_end": false,
        "grants_access": $grantsAccess
      },
      "access": {
        "blocked": $blocked,
        "throttled": $throttled,
        "reasons": [$reasonsJson]
      }
    }
    """
        .trimIndent()
}

internal fun deviceConfigJson(revision: String = "0123456789abcdef"): String =
    """
    {
      "interface_id": "iface-1",
      "interface_name": "awg0",
      "node_id": "node-1",
      "endpoint": "vpn.example.com:51820",
      "addresses": ["10.8.0.2/32"],
      "conf": "[Interface]\nPrivateKey = secret\n",
      "revision": "$revision"
    }
    """
        .trimIndent()

internal fun appDeviceJson(deviceName: String = "Pixel"): String =
    """
    {
      "device": {
        "id": "device-1",
        "user_id": "user-1",
        "group_id": "group-1",
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "node_name": "Frankfurt",
        "name": "$deviceName",
        "down_kbps": 0,
        "up_kbps": 0,
        "revoked": false,
        "external": false,
        "created_at": "2026-01-03T09:00:00Z",
        "peers": [],
        "addresses": ["10.8.0.2/32"]
      },
      "config": {
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "endpoint": "vpn.example.com:51820",
        "addresses": ["10.8.0.2/32"],
        "conf": "[Interface]\nPrivateKey = secret\n",
        "revision": "0123456789abcdef"
      }
    }
    """
        .trimIndent()

internal fun deviceJson(
    id: String = "device-1",
    name: String = "Pixel",
    revoked: Boolean = false,
    addresses: List<String> = listOf("10.8.0.2/32"),
): String =
    """
    {
      "id": "$id",
      "user_id": "user-1",
      "group_id": "group-1",
      "interface_id": "iface-1",
      "interface_name": "awg0",
      "node_id": "node-1",
      "node_name": "Frankfurt",
      "name": "$name",
      "down_kbps": 0,
      "up_kbps": 0,
      "revoked": $revoked,
      "external": false,
      "created_at": "2026-01-03T09:00:00Z",
      "peers": [],
      "addresses": [${addresses.joinToString(",") { "\"$it\"" }}]
    }
    """
        .trimIndent()

internal fun devicePageJson(
    devices: List<String>,
    total: Int = devices.size,
    limit: Int = 20,
    offset: Int = 0,
): String =
    """
    {
      "items": [${devices.joinToString(",")}],
      "total": $total,
      "limit": $limit,
      "offset": $offset
    }
    """
        .trimIndent()

internal fun bootstrapJsonWithDevices(
    devices: List<String>,
    devicesTotal: Int? = null,
): String {
    val totalLine = devicesTotal?.let { "\"devices_total\": $it," } ?: ""
    return """
    {
      "user": {
        "id": "user-1",
        "login": "alice",
        "email": "alice@example.com",
        "status": "active",
        "totp_enabled": false,
        "role": "user",
        "disabled": false
      },
      "tariff": null,
      "quota": null,
      $totalLine
      "devices": [${devices.joinToString(",")}],
      "interfaces": []
    }
    """
        .trimIndent()
}
