package space.ivlev.umbravpn.account

import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.SubscriptionStatus

class AccountRepositoryTest {
    @Test
    fun bootstrapParsesTariffQuotaAndDevices() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, bootstrapJson())
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        assertEquals("user-1", snapshot.user.id)
        assertEquals("alice@example.com", snapshot.user.email)
        assertNull(snapshot.subscription)
        assertEquals(false, snapshot.access.blocked)
        assertEquals(false, snapshot.access.throttled)
        assertTrue(snapshot.access.reasons.isEmpty())
        assertNotNull(snapshot.tariff)
        assertEquals("Standard", snapshot.tariff?.name)
        assertEquals(5, snapshot.tariff?.maxDevices)
        assertEquals(100_000, snapshot.tariff?.deviceDownKbps)
        assertEquals(50_000, snapshot.tariff?.deviceUpKbps)
        assertEquals(107_374_182_400L, snapshot.tariff?.trafficQuotaBytes)
        assertEquals(5_368_709_120L, snapshot.quota.usedBytes)
        assertEquals(107_374_182_400L, snapshot.quota.quotaBytes)
        assertEquals(false, snapshot.quota.exceeded)
        assertEquals(102_005_473_280L, snapshot.quota.remainingBytes)
        assertEquals(5.0, snapshot.quota.percent)
        assertEquals("2026-02-01T00:00:00Z", snapshot.quota.resetAt.toString())
        assertEquals(1, snapshot.devices.size)
        val device = snapshot.devices.single()
        assertEquals("device-1", device.id)
        assertEquals("Pixel", device.name)
        assertEquals("awg0", device.interfaceName)
        assertEquals("Frankfurt", device.nodeName)
        assertEquals(listOf("10.8.0.2/32"), device.addresses)
        assertEquals("Bearer access-1", env.requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun bootstrapWithoutTariffUsesEmptyQuotaDefaults() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    """
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
                        "exceeded": false,
                        "remaining_bytes": null,
                        "percent": null,
                        "period_start": "2026-01-01T00:00:00Z",
                        "period_end": "2026-02-01T00:00:00Z",
                        "reset_at": "2026-02-01T00:00:00Z"
                      },
                      "devices": []
                    }
                    """
                        .trimIndent(),
                )
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        assertNull(snapshot.tariff)
        assertEquals(0L, snapshot.quota.usedBytes)
        assertNull(snapshot.quota.quotaBytes)
        assertTrue(snapshot.devices.isEmpty())
    }

    @Test
    fun bootstrapParsesSubscriptionAndAccessFlags() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    bootstrapWithSubscriptionJson(
                        subscriptionStatus = "past_due",
                        grantsAccess = false,
                        blocked = true,
                        throttled = true,
                        reasons =
                            listOf("quota_exceeded", "subscription_inactive", "tariff_missing"),
                    ),
                )
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        val subscription = snapshot.subscription
        assertNotNull(subscription)
        assertEquals("sub-1", subscription?.id)
        assertEquals("Umbra Plus", subscription?.planName)
        assertEquals(SubscriptionStatus.PastDue, subscription?.status)
        assertEquals(false, subscription?.grantsAccess)
        assertEquals(true, subscription?.autoRenew)
        assertEquals(false, subscription?.cancelAtPeriodEnd)
        assertEquals("2026-03-01T00:00:00Z", subscription?.currentPeriodEnd.toString())
        assertNull(snapshot.tariff)
        assertTrue(snapshot.access.blocked)
        assertTrue(snapshot.access.throttled)
        assertTrue(snapshot.access.quotaExceeded)
        assertTrue(snapshot.access.subscriptionInactive)
        assertTrue(snapshot.access.tariffMissing)
    }

    @Test
    fun bootstrapWithoutSubscriptionAndAccessUsesSafeDefaults() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    """
                    {
                      "user": {
                        "id": "user-1",
                        "login": "alice",
                        "email": "alice@example.com",
                        "status": "active",
                        "role": "user",
                        "disabled": false
                      },
                      "tariff": null,
                      "quota": null,
                      "devices": []
                    }
                    """
                        .trimIndent(),
                )
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        assertNull(snapshot.subscription)
        assertTrue(snapshot.access.reasons.isEmpty())
        assertEquals(false, snapshot.access.blocked)
        assertEquals(false, snapshot.access.throttled)
    }

    @Test
    fun expiredAccessRefreshesAndRetriesRequest() = runTest {
        val env =
            createEnvironment(initialSession = storedSession(), nowEpochSeconds = 1_700_000_000L) {
                request ->
                val authorization = request.headers[HttpHeaders.Authorization]
                when (request.url.encodedPath) {
                    "/api/v1/app/bootstrap" ->
                        if (authorization == "Bearer new-access") {
                            jsonResponse(HttpStatusCode.OK, bootstrapJson())
                        } else {
                            jsonResponse(
                                HttpStatusCode.Unauthorized,
                                errorBody("unauthorized", "expired"),
                            )
                        }
                    "/api/v1/auth/refresh" ->
                        jsonResponse(
                            HttpStatusCode.OK,
                            authJson(token = "new-access", refreshToken = "refresh-2"),
                        )
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        assertEquals("user-1", snapshot.user.id)
        assertEquals(
            listOf("/api/v1/app/bootstrap", "/api/v1/auth/refresh", "/api/v1/app/bootstrap"),
            env.requests.map { it.url.encodedPath },
        )
        val refreshRequest = env.requests[1]
        assertEquals(HttpMethod.Post, refreshRequest.method)
        assertTrue(
            refreshRequest.body
                .toByteArray()
                .decodeToString()
                .contains("\"refresh_token\":\"refresh-1\""),
        )
        assertEquals("new-access", env.tokenStore.session?.accessToken)
        assertEquals("refresh-2", env.tokenStore.session?.refreshToken)
        assertEquals(1_700_003_600L, env.tokenStore.session?.expiresAtEpochSeconds)
        val state = env.sessionManager.state.value
        assertTrue(state is SessionState.Active)
        assertEquals("user-1", (state as SessionState.Active).user.id)
    }

    @Test
    fun failedRefreshClearsSession() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when (request.url.encodedPath) {
                    "/api/v1/app/bootstrap" ->
                        jsonResponse(
                            HttpStatusCode.Unauthorized,
                            errorBody("unauthorized", "expired"),
                        )
                    "/api/v1/auth/refresh" ->
                        jsonResponse(
                            HttpStatusCode.Unauthorized,
                            errorBody("invalid_token", "revoked"),
                        )
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val error = env.accountRepository.bootstrap().requireFailure()

        assertEquals(AccountError.SessionExpired, error)
        assertNull(env.tokenStore.session)
        assertEquals(SessionState.Expired, env.sessionManager.state.value)
        assertEquals(2, env.requests.size)
    }

    @Test
    fun refreshOnlyOnceWhenRetryIsUnauthorized() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when (request.url.encodedPath) {
                    "/api/v1/auth/refresh" ->
                        jsonResponse(
                            HttpStatusCode.OK,
                            authJson(token = "new-access", refreshToken = "refresh-2"),
                        )
                    else ->
                        jsonResponse(
                            HttpStatusCode.Unauthorized,
                            errorBody("unauthorized", "expired"),
                        )
                }
            }

        val error = env.accountRepository.bootstrap().requireFailure()

        assertEquals(AccountError.SessionExpired, error)
        assertNull(env.tokenStore.session)
        assertEquals(
            listOf("/api/v1/app/bootstrap", "/api/v1/auth/refresh", "/api/v1/app/bootstrap"),
            env.requests.map { it.url.encodedPath },
        )
    }

    @Test
    fun refreshRateLimitedKeepsSession() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when (request.url.encodedPath) {
                    "/api/v1/auth/refresh" ->
                        jsonResponse(
                            HttpStatusCode.TooManyRequests,
                            errorBody("too_many_requests", "too many refresh attempts"),
                        )
                    else ->
                        jsonResponse(
                            HttpStatusCode.Unauthorized,
                            errorBody("unauthorized", "expired"),
                        )
                }
            }

        val error = env.accountRepository.bootstrap().requireFailure()

        assertEquals(AccountError.Network, error)
        assertEquals("access-1", env.tokenStore.session?.accessToken)
        assertTrue(env.sessionManager.state.value != SessionState.Expired)
    }

    @Test
    fun deviceConfigParsesRevision() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when (request.url.encodedPath) {
                    "/api/v1/app/devices/device-1/config" ->
                        jsonResponse(HttpStatusCode.OK, deviceConfigJson("0123456789abcdef"))
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val config = env.accountRepository.deviceConfig("device-1").requireSuccess()

        assertEquals("iface-1", config.interfaceId)
        assertEquals("awg0", config.interfaceName)
        assertEquals("vpn.example.com:51820", config.endpoint)
        assertEquals(listOf("10.8.0.2/32"), config.addresses)
        assertEquals("0123456789abcdef", config.revision)
        assertTrue(config.conf.contains("PrivateKey"))
    }

    @Test
    fun createDeviceSendsNameAndReturnsConfig() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when {
                    request.url.encodedPath == "/api/v1/app/devices" &&
                        request.method == HttpMethod.Post ->
                        jsonResponse(HttpStatusCode.Created, appDeviceJson("Phone"))
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val created = env.accountRepository.createDevice("Phone").requireSuccess()

        assertEquals("Phone", created.device.name)
        assertEquals("0123456789abcdef", created.config.revision)
        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/app/devices", request.url.encodedPath)
        assertEquals("""{"name":"Phone"}""", request.body.toByteArray().decodeToString())
    }

    @Test
    fun bootstrapParsesInterfacesAndDevicePeers() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, bootstrapJson())
            }

        val snapshot = env.accountRepository.bootstrap().requireSuccess()

        assertEquals(2, snapshot.interfaces.size)
        val first = snapshot.interfaces.first()
        assertEquals("iface-1", first.id)
        assertEquals("awg0", first.name)
        assertEquals("node-1", first.nodeId)
        assertEquals("Frankfurt", first.nodeName)
        val peers = snapshot.devices.single().peers
        assertEquals(listOf("iface-1", "iface-2"), peers.map { it.interfaceId })
        assertEquals(listOf("awg0", "awg1"), peers.map { it.interfaceName })
        assertEquals(listOf("peer-key-1", "peer-key-2"), peers.map { it.publicKey })
    }

    @Test
    fun createDeviceSendsSelectedInterfaces() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when {
                    request.url.encodedPath == "/api/v1/app/devices" &&
                        request.method == HttpMethod.Post ->
                        jsonResponse(HttpStatusCode.Created, appDeviceWithConfigsJson("Phone"))
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        env.accountRepository.createDevice("Phone", listOf("iface-1", "iface-2")).requireSuccess()

        val body = env.requests.single().body.toByteArray().decodeToString()
        assertTrue(body.contains("\"name\":\"Phone\""))
        assertTrue(body.contains("\"interface_ids\":[\"iface-1\",\"iface-2\"]"))
    }

    @Test
    fun createDeviceParsesConfigsWithFallbackToPrimary() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when {
                    request.url.encodedPath == "/api/v1/app/devices" &&
                        request.method == HttpMethod.Post ->
                        jsonResponse(HttpStatusCode.Created, appDeviceWithConfigsJson("Phone"))
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val created = env.accountRepository.createDevice("Phone").requireSuccess()

        assertEquals("0123456789abcdef", created.config.revision)
        assertEquals(2, created.configs.size)
        assertEquals(2, created.allConfigs.size)
        assertEquals(listOf("iface-1", "iface-2"), created.configs.map { it.interfaceId })
        assertEquals("fedcba9876543210", created.configs[1].revision)
        assertEquals(2, created.device.peers.size)
    }

    @Test
    fun createDeviceWithoutConfigsFallsBackToSingleConfig() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.Created, appDeviceJson("Phone"))
            }

        val created = env.accountRepository.createDevice("Phone").requireSuccess()

        assertEquals(listOf(created.config), created.configs)
        assertEquals(listOf(created.config), created.allConfigs)
    }

    @Test
    fun deviceConfigsParsesAllInterfaces() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when (request.url.encodedPath) {
                    "/api/v1/app/devices/device-1/configs" ->
                        jsonResponse(
                            HttpStatusCode.OK,
                            """
                            [
                              {
                                "interface_id": "iface-1",
                                "interface_name": "awg0",
                                "node_id": "node-1",
                                "endpoint": "vpn.example.com:51820",
                                "addresses": ["10.8.0.2/32"],
                                "conf": "[Interface]",
                                "revision": "rev-1"
                              },
                              {
                                "interface_id": "iface-2",
                                "interface_name": "awg1",
                                "node_id": "node-2",
                                "endpoint": "ams.example.com:51820",
                                "addresses": ["10.9.0.2/32"],
                                "conf": "[Interface]",
                                "revision": "rev-2"
                              }
                            ]
                            """
                                .trimIndent(),
                        )
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val configs = env.accountRepository.deviceConfigs("device-1").requireSuccess()

        assertEquals(2, configs.size)
        assertEquals(listOf("iface-1", "iface-2"), configs.map { it.interfaceId })
        assertEquals(listOf("rev-1", "rev-2"), configs.map { it.revision })
    }

    @Test
    fun createDeviceConflictReturnsApiError() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.Conflict, errorBody("conflict", "device limit reached"))
            }

        val error = env.accountRepository.createDevice("Phone").requireFailure()

        assertEquals(AccountError.Api(409, "conflict", "device limit reached"), error)
    }

    @Test
    fun renameDeviceSendsPatch() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when {
                    request.url.encodedPath == "/api/v1/app/devices/device-1" &&
                        request.method == HttpMethod.Patch ->
                        jsonResponse(
                            HttpStatusCode.OK,
                            """
                            {
                              "id": "device-1",
                              "user_id": "user-1",
                              "group_id": "group-1",
                              "interface_id": "iface-1",
                              "interface_name": "awg0",
                              "node_id": "node-1",
                              "node_name": "Frankfurt",
                              "name": "Laptop",
                              "down_kbps": 0,
                              "up_kbps": 0,
                              "revoked": false,
                              "external": false,
                              "created_at": "2026-01-03T09:00:00Z",
                              "peers": [],
                              "addresses": []
                            }
                            """
                                .trimIndent(),
                        )
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        val device = env.accountRepository.renameDevice("device-1", "Laptop").requireSuccess()

        assertEquals("Laptop", device.name)
        assertEquals(
            """{"name":"Laptop"}""",
            env.requests.single().body.toByteArray().decodeToString(),
        )
    }

    @Test
    fun deleteDeviceAcceptsEmptyBody() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) { request ->
                when {
                    request.url.encodedPath == "/api/v1/app/devices/device-1" &&
                        request.method == HttpMethod.Delete ->
                        emptyResponse(HttpStatusCode.NoContent)
                    else -> jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "unknown"))
                }
            }

        env.accountRepository.deleteDevice("device-1").requireSuccess()

        assertEquals(HttpMethod.Delete, env.requests.single().method)
    }

    @Test
    fun networkFailureReturnsNetworkError() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                throw java.io.IOException("offline")
            }

        val error = env.accountRepository.bootstrap().requireFailure()

        assertEquals(AccountError.Network, error)
        assertNotNull(env.tokenStore.session)
    }
}
