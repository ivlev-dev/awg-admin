package space.ivlev.umbravpn.admin

import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.account.errorBody
import space.ivlev.umbravpn.account.requireFailure
import space.ivlev.umbravpn.account.requireSuccess
import space.ivlev.umbravpn.data.account.IDEMPOTENCY_KEY_HEADER
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.admin.AdminRoleFilter
import space.ivlev.umbravpn.domain.model.admin.AdminStatusFilter
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab

class AdminApiTest {

    @Test
    fun pageUsersSendsFiltersAndParsesFullNameAndEmail() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                adminUserPageJson(
                    items =
                        listOf(
                            adminUserJson(
                                fullName = " Иван Петров ",
                                email = "ivan@example.com",
                                role = "admin",
                            ),
                        ),
                    total = 41,
                    limit = 20,
                    offset = 20,
                ),
            )
        }

        val page =
            env.api
                .pageUsers(
                    AdminUserQuery(
                        limit = 20,
                        offset = 20,
                        query = " ivan ",
                        tab = AdminUserTab.Pending,
                        role = AdminRoleFilter.Admin,
                        status = AdminStatusFilter.Disabled,
                    ),
                )
                .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Get, request.method)
        assertEquals("/api/v1/users/page", request.url.encodedPath)
        assertEquals("20", request.url.parameters["limit"])
        assertEquals("20", request.url.parameters["offset"])
        assertEquals("ivan", request.url.parameters["q"])
        assertEquals("pending", request.url.parameters["tab"])
        assertEquals("admin", request.url.parameters["role"])
        assertEquals("disabled", request.url.parameters["status"])
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])

        val user = page.items.single()
        assertEquals("Иван Петров", user.fullName)
        assertEquals("ivan@example.com", user.email)
        assertEquals(UserRole.Admin, user.role)
        assertEquals(41, page.total)
        assertEquals(20, page.offset)
    }

    @Test
    fun pageUsersOmitsEmptySearchAndDefaultFilters() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, adminUserPageJson(items = emptyList()))
        }

        env.api.pageUsers(AdminUserQuery()).requireSuccess()

        val parameters = env.requests.single().url.parameters
        assertEquals("20", parameters["limit"])
        assertEquals("0", parameters["offset"])
        assertEquals("active", parameters["tab"])
        assertNull(parameters["q"])
        assertNull(parameters["role"])
        assertNull(parameters["status"])
    }

    @Test
    fun createUserPostsBodyWithIdempotencyKey() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                adminUserJson(fullName = "Bob Stone", email = "bob@example.com", role = "admin"),
            )
        }

        val created =
            env.api
                .createUser(
                    AdminUserDraft(
                        email = " bob@example.com ",
                        fullName = "Bob Stone",
                        role = UserRole.Admin,
                        tariffId = "tariff-1",
                        nodeId = "node-1",
                        groupId = "group-1",
                        password = "password123",
                    ),
                )
                .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/users", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"email\":\"bob@example.com\""))
        assertTrue(body, body.contains("\"full_name\":\"Bob Stone\""))
        assertTrue(body, body.contains("\"role\":\"admin\""))
        assertTrue(body, body.contains("\"password\":\"password123\""))
        assertTrue(body, body.contains("\"tariff_id\":\"tariff-1\""))
        assertEquals("Bob Stone", created.fullName)
    }

    @Test
    fun updateUserClearsOptionalFieldsWithExplicitNulls() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, adminUserJson(fullName = null, disabled = true))
        }

        env.api
            .updateUser(
                "user-1",
                AdminUserDraft(
                    email = "alice@example.com",
                    fullName = null,
                    role = UserRole.User,
                    tariffId = null,
                    nodeId = null,
                    groupId = null,
                    disabled = true,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Patch, request.method)
        assertEquals("/api/v1/users/user-1", request.url.encodedPath)
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"full_name\":null"))
        assertTrue(body, body.contains("\"tariff_id\":null"))
        assertTrue(body, body.contains("\"node_id\":null"))
        assertTrue(body, body.contains("\"group_id\":null"))
        assertTrue(body, body.contains("\"disabled\":true"))
    }

    @Test
    fun resetPasswordUsesPasswordPathAndIdempotency() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, """{"ok":true}""") }

        env.api.resetPassword("user-1", "password456").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/users/user-1/password", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        assertEquals(
            """{"new_password":"password456"}""",
            request.body.toByteArray().decodeToString(),
        )
    }

    @Test
    fun approveSendsTariffAndReturnsActiveUser() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                adminUserJson(status = "active", role = "user"),
            )
        }

        val approved = env.api.approveUser("user-2", "tariff-9", nodeId = "node-1").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/users/user-2/approve", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"tariff_id\":\"tariff-9\""))
        assertTrue(body, body.contains("\"node_id\":\"node-1\""))
        assertFalse(body, body.contains("group_id"))
        assertEquals(UserStatus.Active, approved.status)
    }

    @Test
    fun rejectUsesRejectPathAndIdempotency() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, adminUserJson(status = "rejected"))
        }

        env.api.rejectUser("user-3").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/users/user-3/reject", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun tariffsAreParsedWithInterfaceAndQuota() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, "[${adminTariffJson()}]") }

        val tariff = env.api.listTariffs().requireSuccess().single()

        assertEquals("Standard", tariff.name)
        assertEquals(5, tariff.maxDevices)
        assertEquals(100_000, tariff.deviceDownKbps)
        assertEquals(107_374_182_400L, tariff.trafficQuotaBytes)
        assertEquals("iface-1", tariff.interfaceId)
        assertEquals("awg0", tariff.interfaceName)
        assertEquals("/api/v1/tariffs", env.requests.single().url.encodedPath)
    }

    @Test
    fun createTariffPostsLimitsAndIdempotency() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, adminTariffJson()) }

        env.api
            .createTariff(
                AdminTariffDraft(
                    name = " Basic ",
                    description = " Starter ",
                    maxDevices = 3,
                    deviceDownKbps = 10_000,
                    deviceUpKbps = 5_000,
                    trafficQuotaBytes = null,
                    interfaceId = null,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/tariffs", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"name\":\"Basic\""))
        assertTrue(body, body.contains("\"description\":\"Starter\""))
        assertTrue(body, body.contains("\"max_devices\":3"))
        assertTrue(body, body.contains("\"device_down_kbps\":10000"))
        assertTrue(body, body.contains("\"traffic_quota_bytes\":null"))
        assertTrue(body, body.contains("\"interface_id\":null"))
    }

    @Test
    fun deleteTariffUsesDeleteWithoutIdempotency() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, """{"ok":true}""") }

        env.api.deleteTariff("tariff-1").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Delete, request.method)
        assertEquals("/api/v1/tariffs/tariff-1", request.url.encodedPath)
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun httpErrorsAreSurfacedAsApiErrors() = runTest {
        val forbidden = createAdminEnvironment {
            adminJson(HttpStatusCode.Forbidden, errorBody("forbidden", "admin only"))
        }
            .api
            .listTariffs()
            .requireFailure()
        assertEquals(403, (forbidden as AccountError.Api).status)

        val conflict = createAdminEnvironment {
            adminJson(
                HttpStatusCode.Conflict,
                errorBody("conflict", "cannot disable your own account"),
            )
        }
            .api
            .deleteTariff("tariff-1")
            .requireFailure()
        assertEquals(409, (conflict as AccountError.Api).status)

        val notFound = createAdminEnvironment {
            adminJson(HttpStatusCode.NotFound, errorBody("not_found", "user not found"))
        }
            .api
            .user("missing")
            .requireFailure()
        assertEquals(404, (notFound as AccountError.Api).status)

        val rateLimited = createAdminEnvironment {
            adminJson(
                HttpStatusCode.TooManyRequests,
                errorBody("too_many_requests", "slow down"),
            )
        }
            .api
            .deleteUser("user-1")
            .requireFailure()
        assertEquals(429, (rateLimited as AccountError.Api).status)
    }

    @Test
    fun networkFailureIsMappedToNetworkError() = runTest {
        val env = createAdminEnvironment { throw java.io.IOException("offline") }

        val error = env.api.listTariffs().requireFailure()

        assertEquals(AccountError.Network, error)
    }

    @Test
    fun adminMessagesMapHttpStatuses() {
        assertEquals(
            AdminMessage.Forbidden,
            AdminMessages.of(AccountError.Api(403, "forbidden", "admin only")),
        )
        assertEquals(
            AdminMessage.Conflict("limit"),
            AdminMessages.of(AccountError.Api(409, "conflict", "limit")),
        )
        assertEquals(
            AdminMessage.NotFound,
            AdminMessages.of(AccountError.Api(404, "not_found", "missing")),
        )
        assertEquals(
            AdminMessage.RateLimited,
            AdminMessages.of(AccountError.Api(429, "too_many_requests", "later")),
        )
        assertEquals(AdminMessage.Network, AdminMessages.of(AccountError.Network))
    }

    @Test
    fun dashboardCombinesOverviewAndPendingTotal() = runTest {
        val env = createAdminEnvironment { request ->
            when (request.url.encodedPath) {
                "/api/v1/stats/overview" ->
                    adminJson(HttpStatusCode.OK, adminOverviewJson(users = 17))
                "/api/v1/users/page" ->
                    adminJson(
                        HttpStatusCode.OK,
                        adminUserPageJson(items = emptyList(), total = 6, limit = 1),
                    )
                else -> adminJson(HttpStatusCode.NotFound, errorBody("not_found", "missing"))
            }
        }

        val dashboard = env.api.dashboard().requireSuccess()

        assertEquals(17, dashboard.overview.users)
        assertEquals(3, dashboard.overview.nodesTotal)
        assertEquals(6, dashboard.pendingUsers)
        assertEquals(2, env.requests.size)
        assertEquals("pending", env.requests[1].url.parameters["tab"])
        assertEquals("1", env.requests[1].url.parameters["limit"])
    }
}
