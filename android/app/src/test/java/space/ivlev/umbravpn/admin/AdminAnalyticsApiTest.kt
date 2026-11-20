package space.ivlev.umbravpn.admin

import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.account.errorBody
import space.ivlev.umbravpn.account.requireFailure
import space.ivlev.umbravpn.account.requireSuccess
import space.ivlev.umbravpn.data.repository.KtorAdminRepository
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.model.admin.AdminBrowserProfile
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscation
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationIntensity
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationProfile
import space.ivlev.umbravpn.domain.model.admin.AdminPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminStatsQuery

class AdminAnalyticsApiTest {

    @Test
    fun auditSendsCursorFiltersAndParsesPage() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                {
                  "items": [
                    {
                      "id": "audit-1",
                      "at": "2026-11-20T10:00:00Z",
                      "actor_id": "admin-1",
                      "actor_email": "admin@example.com",
                      "actor_login": "admin@example.com",
                      "action": "PATCH",
                      "entity": "users",
                      "entity_id": "user-1",
                      "status": 200,
                      "ip": "203.0.113.10",
                      "details": "{\"email\":\"a@b.c\"}"
                    }
                  ],
                  "next_cursor": "0000000017670006450000:4f1f4f7a-1f0a-4c1a-9c4d-8b2a0d5b1c11"
                }
                """
                    .trimIndent(),
            )
        }

        val page =
            env.api
                .audit(
                    AdminAuditQuery(
                        limit = 25,
                        before = "cursor-1",
                        actor = " adm ",
                        action = "PATCH",
                        entity = "users",
                        from = Instant.ofEpochSecond(1_767_000_000),
                        to = Instant.ofEpochSecond(1_767_003_600),
                    ),
                )
                .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Get, request.method)
        assertEquals("/api/v1/audit", request.url.encodedPath)
        assertEquals("25", request.url.parameters["limit"])
        assertEquals("cursor-1", request.url.parameters["before"])
        assertEquals("adm", request.url.parameters["actor"])
        assertEquals("PATCH", request.url.parameters["action"])
        assertEquals("users", request.url.parameters["entity"])
        assertEquals("1767000000", request.url.parameters["from"])
        assertEquals("1767003600", request.url.parameters["to"])

        val entry = page.items.single()
        assertEquals("admin@example.com", entry.actorEmail)
        assertEquals(200, entry.status)
        assertTrue(entry.succeeded)
        assertEquals("audit-1", entry.id)
        assertEquals(
            "0000000017670006450000:4f1f4f7a-1f0a-4c1a-9c4d-8b2a0d5b1c11",
            page.nextCursor,
        )
    }

    @Test
    fun auditOmitsEmptyFiltersAndCursor() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, """{"items":[],"next_cursor":null}""")
        }

        env.api.audit(AdminAuditQuery(actor = " ", action = "", entity = "  ")).requireSuccess()

        val parameters = env.requests.single().url.parameters
        assertEquals("50", parameters["limit"])
        assertNull(parameters["before"])
        assertNull(parameters["actor"])
        assertNull(parameters["action"])
        assertNull(parameters["entity"])
        assertNull(parameters["from"])
        assertNull(parameters["to"])
    }

    @Test
    fun auditInvalidFilterIsSurfacedAsApiError() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.BadRequest,
                errorBody("invalid_filter", "audit filter: from must not exceed to"),
            )
        }

        val error = env.api.audit(AdminAuditQuery()).requireFailure()

        assertEquals(400, (error as AccountError.Api).status)
    }

    @Test
    fun seriesSendsScopeAndWindow() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                [
                  {"at":"2026-11-20T10:00:00Z","rx":10,"tx":5,"rx_bps":1.5,"tx_bps":0.5}
                ]
                """
                    .trimIndent(),
            )
        }

        val points =
            env.api
                .trafficSeries(
                    scope = "global",
                    from = Instant.ofEpochSecond(1_767_000_000),
                    to = Instant.ofEpochSecond(1_767_003_600),
                )
                .requireSuccess()

        val request = env.requests.single()
        assertEquals("/api/v1/stats/series", request.url.encodedPath)
        assertEquals("global", request.url.parameters["scope"])
        assertEquals("1767000000", request.url.parameters["from"])
        assertEquals("1767003600", request.url.parameters["to"])
        assertEquals(10L, points.single().rx)
        assertEquals(5L, points.single().tx)
        assertEquals(Instant.parse("2026-11-20T10:00:00Z"), points.single().at)
    }

    @Test
    fun aggregateSendsBucketAndParsesPoints() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                {"bucket":"day","points":[{"at":"2026-11-19T00:00:00Z","rx":100,"tx":50}]}
                """
                    .trimIndent(),
            )
        }

        val points =
            env.api
                .trafficAggregate(
                    scope = "global",
                    bucket = "day",
                    from = Instant.ofEpochSecond(1_767_000_000),
                    to = Instant.ofEpochSecond(1_767_600_000),
                )
                .requireSuccess()

        val request = env.requests.single()
        assertEquals("/api/v1/stats/aggregate", request.url.encodedPath)
        assertEquals("global", request.url.parameters["scope"])
        assertEquals("day", request.url.parameters["bucket"])
        assertEquals(100L, points.single().rx)
    }

    @Test
    fun repositoryMapsDayPeriodToSeriesAndLongerToAggregate() = runTest {
        val env = createAdminEnvironment { request ->
            when (request.url.encodedPath) {
                "/api/v1/stats/series" -> adminJson(HttpStatusCode.OK, "[]")
                "/api/v1/stats/aggregate" ->
                    adminJson(HttpStatusCode.OK, """{"bucket":"day","points":[]}""")
                else -> adminJson(HttpStatusCode.NotFound, errorBody("not_found", "missing"))
            }
        }
        val repository = KtorAdminRepository(env.api)
        val from = Instant.ofEpochSecond(1_767_000_000)
        val to = Instant.ofEpochSecond(1_767_600_000)

        repository.traffic(AdminStatsQuery(AdminStatsPeriod.Day24, from, to)).requireSuccess()
        repository.traffic(AdminStatsQuery(AdminStatsPeriod.Month30, from, to)).requireSuccess()

        assertEquals(
            listOf("/api/v1/stats/series", "/api/v1/stats/aggregate"),
            env.requests.map { it.url.encodedPath },
        )
        assertEquals("global", env.requests[0].url.parameters["scope"])
        assertEquals("global", env.requests[1].url.parameters["scope"])
        assertEquals("day", env.requests[1].url.parameters["bucket"])
        assertEquals("1767000000", env.requests[1].url.parameters["from"])
    }

    @Test
    fun quotaUsersParseNullableLimits() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                [
                  {"user_id":"u1","email":"a@b.c","used_bytes":500,"quota_bytes":1000,"exceeded":false,"percent":50.0},
                  {"user_id":"u2","email":"c@d.e","used_bytes":7,"quota_bytes":null,"exceeded":false,"percent":null}
                ]
                """
                    .trimIndent(),
            )
        }

        val users = env.api.quotaUsers().requireSuccess()

        assertEquals("/api/v1/quota/users", env.requests.single().url.encodedPath)
        assertEquals(2, users.size)
        assertEquals(1_000L, users[0].quotaBytes)
        assertNull(users[1].quotaBytes)
        assertNull(users[1].percent)
    }

    @Test
    fun settingsLoadAppliesDefaultsForMissingFields() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                {
                  "obfuscation": {
                    "profile": "tls",
                    "intensity": "medium",
                    "browser": "firefox",
                    "mtu": 1380,
                    "jc_min": 4,
                    "jc_max": 6,
                    "jmin_min": 20,
                    "jmin_max": 40,
                    "jmax_extra_min": 30,
                    "jmax_extra_max": 90,
                    "s_min": 16,
                    "s_max": 64,
                    "hosts": ["example.org"],
                    "random_trailers": false,
                    "disable_cookies": true
                  },
                  "share_default_ttl_secs": 600,
                  "stats_retention_days": 30
                }
                """
                    .trimIndent(),
            )
        }

        val settings = env.api.settings().requireSuccess()

        assertEquals("/api/v1/settings", env.requests.single().url.encodedPath)
        assertEquals(AdminObfuscationProfile.Tls, settings.obfuscation.profile)
        assertEquals(AdminObfuscationIntensity.Medium, settings.obfuscation.intensity)
        assertEquals(AdminBrowserProfile.Firefox, settings.obfuscation.browser)
        assertEquals(1380, settings.obfuscation.mtu)
        assertEquals(16, settings.obfuscation.sMin)
        assertEquals(listOf("example.org"), settings.obfuscation.hosts)
        assertEquals(15, settings.obfuscation.keepaliveMin)
        assertEquals(25, settings.obfuscation.keepaliveMax)
        assertEquals(600L, settings.shareDefaultTtlSecs)
        assertEquals(30, settings.statsRetentionDays)
    }

    @Test
    fun settingsUpdateSendsFullPayload() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                {
                  "obfuscation": {
                    "profile": "quic",
                    "intensity": "low",
                    "browser": "safari",
                    "mtu": 1280,
                    "jc_min": 2,
                    "jc_max": 4,
                    "jmin_min": 10,
                    "jmin_max": 20,
                    "jmax_extra_min": 30,
                    "jmax_extra_max": 60,
                    "s_min": 20,
                    "s_max": 40,
                    "hosts": ["one.example","two.example"],
                    "random_trailers": true,
                    "disable_cookies": false,
                    "keepalive_min": 10,
                    "keepalive_max": 20
                  },
                  "share_default_ttl_secs": 120,
                  "stats_retention_days": 14
                }
                """
                    .trimIndent(),
            )
        }

        val settings =
            AdminPanelSettings(
                obfuscation =
                    AdminObfuscation(
                        profile = AdminObfuscationProfile.Quic,
                        intensity = AdminObfuscationIntensity.Low,
                        browser = AdminBrowserProfile.Safari,
                        mtu = 1280,
                        jcMin = 2,
                        jcMax = 4,
                        jminMin = 10,
                        jminMax = 20,
                        jmaxExtraMin = 30,
                        jmaxExtraMax = 60,
                        sMin = 20,
                        sMax = 40,
                        hosts = listOf("one.example", "two.example"),
                        randomTrailers = true,
                        disableCookies = false,
                        keepaliveMin = 10,
                        keepaliveMax = 20,
                    ),
                shareDefaultTtlSecs = 120,
                statsRetentionDays = 14,
            )

        val updated = env.api.updateSettings(settings).requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Put, request.method)
        assertEquals("/api/v1/settings", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"profile\":\"quic\""))
        assertTrue(body, body.contains("\"intensity\":\"low\""))
        assertTrue(body, body.contains("\"browser\":\"safari\""))
        assertTrue(body, body.contains("\"mtu\":1280"))
        assertTrue(body, body.contains("\"jc_min\":2"))
        assertTrue(body, body.contains("\"jmin_max\":20"))
        assertTrue(body, body.contains("\"jmax_extra_max\":60"))
        assertTrue(body, body.contains("\"s_min\":20"))
        assertTrue(body, body.contains("\"hosts\":[\"one.example\",\"two.example\"]"))
        assertTrue(body, body.contains("\"random_trailers\":true"))
        assertTrue(body, body.contains("\"disable_cookies\":false"))
        assertTrue(body, body.contains("\"keepalive_min\":10"))
        assertTrue(body, body.contains("\"keepalive_max\":20"))
        assertTrue(body, body.contains("\"share_default_ttl_secs\":120"))
        assertTrue(body, body.contains("\"stats_retention_days\":14"))
        assertEquals(14, updated.statsRetentionDays)
        assertEquals(120L, updated.shareDefaultTtlSecs)
    }

    @Test
    fun settingsUpdateBadRequestIsSurfaced() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.BadRequest,
                errorBody("bad_request", "PersistentKeepalive range must be positive"),
            )
        }

        val error = env.api.updateSettings(AdminPanelSettings()).requireFailure()

        assertEquals(400, (error as AccountError.Api).status)
        assertFalse(error.message.isNullOrBlank())
    }

    @Test
    fun overviewParsesTrafficAndTopDevices() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """
                {
                  "today": {"rx": 1200, "tx": 3400},
                  "month": {"rx": 50000, "tx": 90000},
                  "rx_bps": 12.5,
                  "tx_bps": 3.5,
                  "nodes_online": 2,
                  "nodes_total": 3,
                  "interfaces": 5,
                  "groups": 2,
                  "devices": 34,
                  "users": 12,
                  "top_devices": [
                    {"device_id":"dev-1","name":"Phone","user_id":"u1","rx":900,"tx":100,"online":true}
                  ]
                }
                """
                    .trimIndent(),
            )
        }

        val overview = env.api.overview().requireSuccess()

        assertEquals(1_200L, overview.today.rx)
        assertEquals(3_400L, overview.today.tx)
        assertEquals(4_600L, overview.today.total)
        assertEquals(12.5, overview.rxBps, 0.0)
        assertEquals("Phone", overview.topDevices.single().name)
        assertTrue(overview.topDevices.single().online)
        assertEquals(1_000L, overview.topDevices.single().total)
    }
}
