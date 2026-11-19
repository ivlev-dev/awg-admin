package space.ivlev.umbravpn.account

import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.data.account.IDEMPOTENCY_KEY_HEADER
import space.ivlev.umbravpn.domain.model.account.AccountError

class AccountTunnelApiTest {

    @Test
    fun bootstrapParsesPeerIdentifiersAndLabels() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, bootstrapWithPeersJson())
            }

        val device = env.accountRepository.bootstrap().requireSuccess().devices.single()

        assertEquals(2, device.peers.size)
        assertEquals("peer-1", device.peers[0].peerId)
        assertEquals("primary", device.peers[0].label)
        assertEquals("iface-1", device.peers[0].interfaceId)
        assertEquals("peer-2", device.peers[1].peerId)
        assertEquals("second", device.peers[1].label)
    }

    @Test
    fun deviceConfigsParsePeerIdentifiersAndLabels() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.OK,
                    """
                    [
                      {
                        "peer_id": "peer-1",
                        "label": "primary",
                        "interface_id": "iface-1",
                        "interface_name": "awg0",
                        "node_id": "node-1",
                        "endpoint": "vpn.example.com:51820",
                        "addresses": ["10.8.0.2/32"],
                        "conf": "[Interface]\nPrivateKey = secret\n",
                        "revision": "rev-1"
                      },
                      {
                        "peer_id": "peer-2",
                        "label": "second",
                        "interface_id": "iface-1",
                        "interface_name": "awg0",
                        "node_id": "node-1",
                        "endpoint": "vpn.example.com:51821",
                        "addresses": ["10.8.0.3/32"],
                        "conf": "[Interface]\nPrivateKey = second\n",
                        "revision": "rev-2"
                      }
                    ]
                    """
                        .trimIndent(),
                )
            }

        val configs = env.accountRepository.deviceConfigs("device-1").requireSuccess()

        assertEquals(listOf("peer-1", "peer-2"), configs.map { it.peerId })
        assertEquals(listOf("primary", "second"), configs.map { it.label })
    }

    @Test
    fun legacyConfigsWithoutPeerFieldsFallBackToEmptyValues() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, "[" + deviceConfigJson() + "]")
            }

        val config = env.accountRepository.deviceConfigs("device-1").requireSuccess().single()

        assertEquals("", config.peerId)
        assertEquals("", config.label)
        assertEquals("iface-1", config.interfaceId)
    }

    @Test
    fun addTunnelPostsInterfaceAndLabelWithIdempotencyKey() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, appDeviceWithPeersJson())
            }

        val created =
            env.accountRepository
                .addDeviceTunnel(deviceId = "device-1", interfaceId = "iface-1", label = " extra ")
                .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/api/v1/app/devices/device-1/tunnels", request.url.encodedPath)
        val body = request.body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"interface_id\":\"iface-1\""))
        assertTrue(body, body.contains("\"label\":\"extra\""))
        val key = request.headers[IDEMPOTENCY_KEY_HEADER]
        assertNotNull(key)
        assertEquals(key, request.headers[IDEMPOTENCY_KEY_HEADER])

        assertEquals(2, created.configs.size)
        assertEquals("peer-2", created.configs[1].peerId)
        assertEquals("extra", created.configs[1].label)
        assertEquals("peer-1", created.config.peerId)
    }

    @Test
    fun addTunnelWithoutLabelOmitsLabelField() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, appDeviceWithPeersJson())
            }

        env.accountRepository
            .addDeviceTunnel(deviceId = "device-1", interfaceId = "iface-2")
            .requireSuccess()

        val body = env.requests.single().body.toByteArray().decodeToString()
        assertTrue(body, body.contains("\"interface_id\":\"iface-2\""))
        assertTrue(body, !body.contains("\"label\""))
    }

    @Test
    fun addTunnelUsesExplicitIdempotencyKey() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, appDeviceWithPeersJson())
            }

        env.accountRepository
            .addDeviceTunnel(
                deviceId = "device-1",
                interfaceId = "iface-1",
                label = "extra",
                idempotencyKey = "key-1",
            )
            .requireSuccess()

        assertEquals("key-1", env.requests.single().headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun removeTunnelSendsDeleteWithoutIdempotencyKey() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                emptyResponse(HttpStatusCode.NoContent)
            }

        env.accountRepository.removeDeviceTunnel("device-1", "peer-2").requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Delete, request.method)
        assertEquals("/api/v1/app/devices/device-1/tunnels/peer-2", request.url.encodedPath)
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun removeLastTunnelConflictIsMappedToApiError() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(
                    HttpStatusCode.Conflict,
                    errorBody("conflict", "device must keep at least one peer"),
                )
            }

        val error = env.accountRepository.removeDeviceTunnel("device-1", "peer-1").requireFailure()

        assertTrue(error is AccountError.Api)
        assertEquals(409, (error as AccountError.Api).status)
    }

    @Test
    fun renameTunnelSendsPatchWithLabelAndNoIdempotencyKey() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.OK, renamedTunnelResponseJson())
            }

        val device =
            env.accountRepository
                .renameDeviceTunnel("device-1", "peer-2", "renamed")
                .requireSuccess()

        val request = env.requests.single()
        assertEquals(HttpMethod.Patch, request.method)
        assertEquals("/api/v1/app/devices/device-1/tunnels/peer-2", request.url.encodedPath)
        assertEquals("""{"label":"renamed"}""", request.body.toByteArray().decodeToString())
        assertNull(request.headers[IDEMPOTENCY_KEY_HEADER])
        assertEquals("renamed", device.peers.single { it.peerId == "peer-2" }.label)
    }

    @Test
    fun renameTunnelNotFoundIsMappedToApiError() = runTest {
        val env =
            createEnvironment(initialSession = storedSession()) {
                jsonResponse(HttpStatusCode.NotFound, errorBody("not_found", "tunnel not found"))
            }

        val error =
            env.accountRepository
                .renameDeviceTunnel("device-1", "peer-2", "renamed")
                .requireFailure()

        assertTrue(error is AccountError.Api)
        assertEquals(404, (error as AccountError.Api).status)
    }
}

private fun bootstrapWithPeersJson(): String =
    """
    {
      "user": {
        "id": "user-1",
        "full_name": "Alice Ivanova",
        "email": "alice@example.com",
        "status": "active",
        "totp_enabled": false,
        "role": "user",
        "disabled": false
      },
      "tariff": null,
      "quota": {
        "used_bytes": 0,
        "quota_bytes": null,
        "exceeded": false,
        "remaining_bytes": null,
        "percent": null,
        "period_start": null,
        "period_end": null,
        "reset_at": null
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
          "revoked": false,
          "external": false,
          "created_at": "2026-01-03T09:00:00Z",
          "peers": [
            {
              "peer_id": "peer-1",
              "label": "primary",
              "interface_id": "iface-1",
              "interface_name": "awg0",
              "public_key": "peer-key-1",
              "addresses": ["10.8.0.2/32"]
            },
            {
              "peer_id": "peer-2",
              "label": "second",
              "interface_id": "iface-1",
              "interface_name": "awg0",
              "public_key": "peer-key-2",
              "addresses": ["10.8.0.3/32"]
            }
          ],
          "addresses": ["10.8.0.2/32", "10.8.0.3/32"]
        }
      ],
      "interfaces": [
        {"id": "iface-1", "name": "awg0", "node_id": "node-1", "node_name": "Frankfurt"}
      ]
    }
    """
        .trimIndent()

private fun renamedTunnelResponseJson(): String =
    """
    {
      "device": ${deviceWithRenamedPeerJson()},
      "config": {
        "peer_id": "peer-1",
        "label": "primary",
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "endpoint": "vpn.example.com:51820",
        "addresses": ["10.8.0.2/32"],
        "conf": "[Interface]\nPrivateKey = secret\n",
        "revision": "rev-1"
      },
      "configs": []
    }
    """
        .trimIndent()

private fun deviceWithRenamedPeerJson(): String =
    """
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
      "revoked": false,
      "external": false,
      "created_at": "2026-01-03T09:00:00Z",
      "peers": [
        {
          "peer_id": "peer-1",
          "label": "primary",
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "public_key": "peer-key-1",
          "addresses": ["10.8.0.2/32"]
        },
        {
          "peer_id": "peer-2",
          "label": "renamed",
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "public_key": "peer-key-2",
          "addresses": ["10.8.0.3/32"]
        }
      ],
      "addresses": ["10.8.0.2/32", "10.8.0.3/32"]
    }
    """
        .trimIndent()

private fun appDeviceWithPeersJson(): String =
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
        "name": "Pixel",
        "down_kbps": 0,
        "up_kbps": 0,
        "revoked": false,
        "external": false,
        "created_at": "2026-01-03T09:00:00Z",
        "peers": [
          {
            "peer_id": "peer-1",
            "label": "primary",
            "interface_id": "iface-1",
            "interface_name": "awg0",
            "public_key": "peer-key-1",
            "addresses": ["10.8.0.2/32"]
          },
          {
            "peer_id": "peer-2",
            "label": "extra",
            "interface_id": "iface-1",
            "interface_name": "awg0",
            "public_key": "peer-key-2",
            "addresses": ["10.8.0.3/32"]
          }
        ],
        "addresses": ["10.8.0.2/32", "10.8.0.3/32"]
      },
      "config": {
        "peer_id": "peer-1",
        "label": "primary",
        "interface_id": "iface-1",
        "interface_name": "awg0",
        "node_id": "node-1",
        "endpoint": "vpn.example.com:51820",
        "addresses": ["10.8.0.2/32"],
        "conf": "[Interface]\nPrivateKey = secret\n",
        "revision": "rev-1"
      },
      "configs": [
        {
          "peer_id": "peer-1",
          "label": "primary",
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "node_id": "node-1",
          "endpoint": "vpn.example.com:51820",
          "addresses": ["10.8.0.2/32"],
          "conf": "[Interface]\nPrivateKey = secret\n",
          "revision": "rev-1"
        },
        {
          "peer_id": "peer-2",
          "label": "extra",
          "interface_id": "iface-1",
          "interface_name": "awg0",
          "node_id": "node-1",
          "endpoint": "vpn.example.com:51821",
          "addresses": ["10.8.0.3/32"],
          "conf": "[Interface]\nPrivateKey = second\n",
          "revision": "rev-2"
        }
      ]
    }
    """
        .trimIndent()
