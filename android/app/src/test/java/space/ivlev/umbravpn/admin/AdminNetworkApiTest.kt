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
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.admin.AdminGroupDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceUpdate
import space.ivlev.umbravpn.domain.model.admin.AdminNodeDraft
import space.ivlev.umbravpn.domain.model.admin.AdminPoolDraft
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.domain.model.admin.AdminPoolUpdate

class AdminNetworkApiTest {

    @Test
    fun nodesListParsesStatusAndMetrics() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, "[${adminNodeJson()}]") }

        val node = env.api.nodes().requireSuccess().single()

        val request = env.requests.single()
        assertEquals(HttpMethod.Get, request.method)
        assertEquals("/api/v1/nodes", request.url.encodedPath)
        assertEquals("Frankfurt", node.name)
        assertTrue(node.online)
        assertEquals(2, node.interfaces)
        assertEquals("1.4.0", node.workerVersion)
        assertNotNull(node.lastSeen)
    }

    @Test
    fun createNodePostsNameAndParsesToken() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """{"node":{"id":"node-1","name":"Frankfurt","created_at":"2026-01-01T10:00:00Z"},"token":"secret-token"}""",
            )
        }

        val secret = env.api.createNode(AdminNodeDraft(" Frankfurt ")).requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/nodes", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        assertEquals("""{"name":"Frankfurt"}""", request.body.toByteArray().decodeToString())
        assertEquals("node-1", secret.nodeId)
        assertEquals("Frankfurt", secret.nodeName)
        assertEquals("secret-token", secret.token)
    }

    @Test
    fun rotateNodeUsesRotatePathAndReturnsToken() = runTest {
        val env = createAdminEnvironment {
            adminJson(
                HttpStatusCode.OK,
                """{"node":${adminNodeJson()},"token":"rotated-token"}""",
            )
        }

        val secret = env.api.rotateNodeToken("node-1").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/nodes/node-1/rotate", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        assertEquals("rotated-token", secret.token)
    }

    @Test
    fun deleteNodeUsesDeleteWithoutIdempotency() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, """{"ok":true}""") }

        env.api.deleteNode("node-1").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Delete, request.method)
        assertEquals("/api/v1/nodes/node-1", request.url.encodedPath)
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun interfacesListParsesGroupNodeAndPorts() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, "[${adminInterfaceJson()}]")
        }

        val item = env.api.interfaces().requireSuccess().single()

        assertEquals("/api/v1/interfaces", env.requests.single().url.encodedPath)
        assertEquals("group-1", item.groupId)
        assertEquals("Default", item.groupName)
        assertEquals("vpn.example.com", item.endpointHost)
        assertEquals(51820, item.endpointPort)
        assertEquals(1420, item.mtu)
        assertTrue(item.enabled)
        assertEquals(3, item.peers)
    }

    @Test
    fun createInterfacePostsAllCreateFields() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, adminInterfaceJson()) }

        env.api
            .createInterface(
                AdminInterfaceDraft(
                    groupId = "group-1",
                    nodeId = "node-1",
                    name = "awg0",
                    label = " Main ",
                    endpointHost = " vpn.example.com ",
                    endpointPort = 51820,
                    listenPort = 51821,
                    mtu = 1420,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/interfaces", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"group_id\":\"group-1\""))
        assertTrue(body, body.contains("\"node_id\":\"node-1\""))
        assertTrue(body, body.contains("\"name\":\"awg0\""))
        assertTrue(body, body.contains("\"label\":\"Main\""))
        assertTrue(body, body.contains("\"endpoint_host\":\"vpn.example.com\""))
        assertTrue(body, body.contains("\"endpoint_port\":51820"))
        assertTrue(body, body.contains("\"listen_port\":51821"))
        assertTrue(body, body.contains("\"mtu\":1420"))
    }

    @Test
    fun updateInterfacePatchesEnabledFlag() = runTest {
        val env = createAdminEnvironment {
            adminJson(HttpStatusCode.OK, adminInterfaceJson(enabled = false))
        }

        env.api
            .updateInterface(
                "iface-1",
                AdminInterfaceUpdate(
                    label = "Renamed",
                    endpointHost = "vpn.example.com",
                    endpointPort = 51820,
                    listenPort = 51821,
                    mtu = 1380,
                    enabled = false,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Patch, request.method)
        assertEquals("/api/v1/interfaces/iface-1", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"enabled\":false"))
        assertTrue(body, body.contains("\"mtu\":1380"))
    }

    @Test
    fun rotateAndDeleteInterfaceUseExpectedPaths() = runTest {
        val env = createAdminEnvironment { request ->
            if (request.method == HttpMethod.Delete) {
                adminJson(HttpStatusCode.OK, """{"ok":true}""")
            } else {
                adminJson(HttpStatusCode.OK, adminInterfaceJson())
            }
        }

        env.api.rotateInterface("iface-1").requireSuccess()
        env.api.deleteInterface("iface-1").requireSuccess()

        assertEquals(HttpMethod.Post, env.requests[0].method)
        assertEquals("/api/v1/interfaces/iface-1/rotate", env.requests[0].url.encodedPath)
        assertNotNull(env.requests[0].headers[IDEMPOTENCY_KEY_HEADER])
        assertEquals(HttpMethod.Delete, env.requests[1].method)
        assertEquals("/api/v1/interfaces/iface-1", env.requests[1].url.encodedPath)
        assertNull(env.requests[1].headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun groupsListParsesCounts() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, "[${adminGroupJson()}]") }

        val group = env.api.groups().requireSuccess().single()

        assertEquals("/api/v1/groups", env.requests.single().url.encodedPath)
        assertEquals("Default", group.name)
        assertEquals("10.8.0.0/24", group.baseCidr)
        assertEquals(2, group.interfaces)
        assertEquals(7, group.devices)
        assertFalse(group.forwardingDefault)
    }

    @Test
    fun createGroupPostsBaseCidrAndForwarding() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, adminGroupJson()) }

        env.api
            .createGroup(
                AdminGroupDraft(
                    name = " Default ",
                    description = " Main ",
                    baseCidr = " 10.8.0.0/24 ",
                    forwardingDefault = true,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/groups", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"name\":\"Default\""))
        assertTrue(body, body.contains("\"description\":\"Main\""))
        assertTrue(body, body.contains("\"base_cidr\":\"10.8.0.0/24\""))
        assertTrue(body, body.contains("\"forwarding_default\":true"))
    }

    @Test
    fun updateAndDeleteGroupUseExpectedPaths() = runTest {
        val env = createAdminEnvironment { request ->
            if (request.method == HttpMethod.Delete) {
                adminJson(HttpStatusCode.OK, """{"ok":true}""")
            } else {
                adminJson(HttpStatusCode.OK, adminGroupJson())
            }
        }

        env.api
            .updateGroup(
                "group-1",
                AdminGroupDraft("Renamed", "", "10.9.0.0/24"),
            )
            .requireSuccess()
        env.api.deleteGroup("group-1").requireSuccess()

        assertEquals(HttpMethod.Patch, env.requests[0].method)
        assertEquals("/api/v1/groups/group-1", env.requests[0].url.encodedPath)
        assertEquals(HttpMethod.Delete, env.requests[1].method)
    }

    @Test
    fun poolsListParsesModeAndGateway() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, "[${adminPoolJson()}]") }

        val pool = env.api.pools("group-1").requireSuccess().single()

        assertEquals("/api/v1/groups/group-1/pools", env.requests.single().url.encodedPath)
        assertEquals(AdminPoolMode.RfOnly, pool.mode)
        assertEquals("10.8.0.1", pool.gateway)
        assertTrue(pool.enabled)
    }

    @Test
    fun createPoolPostsCidrModeAndGateway() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, adminPoolJson()) }

        env.api
            .createPool(
                "group-1",
                AdminPoolDraft(
                    name = " RF ",
                    cidr = " 10.8.0.0/25 ",
                    mode = AdminPoolMode.RfOnly,
                    gateway = " 10.8.0.1 ",
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/groups/group-1/pools", request.url.encodedPath)
        assertNotNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"name\":\"RF\""))
        assertTrue(body, body.contains("\"cidr\":\"10.8.0.0/25\""))
        assertTrue(body, body.contains("\"mode\":\"rf_only\""))
        assertTrue(body, body.contains("\"gateway\":\"10.8.0.1\""))
    }

    @Test
    fun updatePoolPatchesModeGatewayAndEnabled() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, adminPoolJson()) }

        env.api
            .updatePool(
                "pool-1",
                AdminPoolUpdate(
                    mode = AdminPoolMode.ExternalOnly,
                    gateway = null,
                    enabled = false,
                ),
            )
            .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Patch, request.method)
        assertEquals("/api/v1/pools/pool-1", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"mode\":\"external_only\""))
        assertTrue(body, body.contains("\"gateway\":null"))
        assertTrue(body, body.contains("\"enabled\":false"))
    }

    @Test
    fun deletePoolUsesDeleteWithoutIdempotency() = runTest {
        val env = createAdminEnvironment { adminJson(HttpStatusCode.OK, """{"ok":true}""") }

        env.api.deletePool("pool-1").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Delete, request.method)
        assertEquals("/api/v1/pools/pool-1", request.url.encodedPath)
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun missingNodeIsMappedToNotFoundApiError() = runTest {
        val error = createAdminEnvironment {
            adminJson(HttpStatusCode.NotFound, errorBody("not_found", "node not found"))
        }
            .api
            .nodes()
            .requireFailure()

        assertEquals(404, (error as AccountError.Api).status)
    }

    private fun adminNodeJson(): String =
        """
        {
          "id": "node-1",
          "name": "Frankfurt",
          "status": "online",
          "online": true,
          "last_seen": "2026-01-02T11:30:00Z",
          "version": "1.4.0",
          "interfaces": 2,
          "token_issued_at": "2026-01-01T10:00:00Z",
          "cpu_load": 0.25,
          "mem_used_bytes": 1024,
          "mem_total_bytes": 2048,
          "kernel_version": "6.8.0",
          "worker_version": "1.4.0",
          "uptime_secs": 3600,
          "metrics_at": "2026-01-02T11:30:00Z"
        }
        """
            .trimIndent()

    private fun adminInterfaceJson(enabled: Boolean = true): String =
        """
        {
          "id": "iface-1",
          "group_id": "group-1",
          "group_name": "Default",
          "node_id": "node-1",
          "node_name": "Frankfurt",
          "name": "awg0",
          "label": "Main",
          "endpoint_host": "vpn.example.com",
          "endpoint_port": 51820,
          "listen_port": 51820,
          "mtu": 1420,
          "public_key": "public-key",
          "obf": {"jc": 4},
          "enabled": $enabled,
          "peers": 3
        }
        """
            .trimIndent()

    private fun adminGroupJson(): String =
        """
        {
          "id": "group-1",
          "name": "Default",
          "description": "Main group",
          "base_cidr": "10.8.0.0/24",
          "forwarding_default": false,
          "created_at": "2026-01-01T10:00:00Z",
          "updated_at": "2026-01-02T11:30:00Z",
          "interfaces": 2,
          "devices": 7
        }
        """
            .trimIndent()

    private fun adminPoolJson(): String =
        """
        {
          "id": "pool-1",
          "group_id": "group-1",
          "name": "RF pool",
          "cidr": "10.8.0.0/25",
          "mode": "rf_only",
          "gateway": "10.8.0.1",
          "enabled": true
        }
        """
            .trimIndent()
}
