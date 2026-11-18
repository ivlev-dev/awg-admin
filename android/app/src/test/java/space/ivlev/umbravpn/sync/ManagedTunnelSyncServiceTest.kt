package space.ivlev.umbravpn.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.sync.SyncResult

class ManagedTunnelSyncServiceTest {

    @Test
    fun emptyBootstrapCreatesDeviceAndImportsTunnel() = runTest {
        val config = deviceConfig()
        val device = accountDevice()
        val env =
            syncEnvironment(snapshot = accountSnapshot(devices = emptyList())) {
                createDeviceResult =
                    AccountResult.Success(CreatedDevice(device = device, config = config))
            }

        val result = env.service.sync()

        assertEquals(SyncResult.Success(created = 1), result)
        assertEquals(listOf("Test Device"), env.createdDeviceNames)
        assertEquals(1, env.account.bootstrapCalls)

        val tunnel = env.tunnels.tunnels.single()
        assertTrue(tunnel.id != 0)
        assertEquals("Pixel", tunnel.name)
        assertEquals(normalizeQuickConfig(config.conf), tunnel.quickConfig)
        assertEquals(0, tunnel.position)

        val binding = env.managed.getByDevice(device.id).singleOrNull()
        assertNotNull(binding)
        assertEquals(tunnel.id, binding?.tunnelId)
        assertEquals("Pixel", binding?.deviceName)
        assertEquals("rev-1", binding?.revision)
        assertEquals("iface-1", binding?.interfaceId)
        assertEquals("vpn.example.com:51820", binding?.endpoint)
        assertEquals(SYNC_TIMESTAMP, binding?.syncedAt)
    }

    @Test
    fun provisionedAccountWithNoDevicesDoesNotCreateAnotherDevice() = runTest {
        val existing = TunnelConfig(id = 9, name = "Old", quickConfig = quickConfig(), position = 0)
        val binding =
            ManagedTunnel(
                deviceId = "device-old",
                tunnelId = 9,
                deviceName = "Old",
                interfaceId = "iface-1",
                endpoint = "vpn.example.com:51820",
                revision = "rev-1",
                syncedAt = 1L,
            )
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = emptyList()),
                tunnels = listOf(existing),
                bindings = listOf(binding),
            )
        env.settings.setManagedProvisioned(true)

        val result = env.service.sync()

        assertEquals(SyncResult.Success(removed = 1), result)
        assertTrue(env.createdDeviceNames.isEmpty())
        assertTrue(env.tunnels.tunnels.isEmpty())
        assertTrue(env.managed.getByDevice("device-old").isEmpty())
    }

    @Test
    fun successfulProvisioningMarksAccountAsProvisioned() = runTest {
        val env =
            syncEnvironment(snapshot = accountSnapshot(devices = emptyList())) {
                createDeviceResult =
                    AccountResult.Success(
                        CreatedDevice(device = accountDevice(), config = deviceConfig()),
                    )
            }

        env.service.sync()

        assertTrue(env.settings.managedProvisioned())
    }

    @Test
    fun sameRevisionKeepsExistingTunnelUntouched() = runTest {
        val existing =
            TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig(), position = 3)
        val binding =
            ManagedTunnel(
                deviceId = "device-1",
                tunnelId = 7,
                deviceName = "Pixel",
                interfaceId = "iface-1",
                endpoint = "vpn.example.com:51820",
                revision = "rev-1",
                syncedAt = 1L,
            )
        val env =
            syncEnvironment(
                tunnels = listOf(existing),
                bindings = listOf(binding),
                configure = {
                    deviceConfigResults["device-1"] = AccountResult.Success(deviceConfig())
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(), result)
        assertEquals(0, env.tunnels.saveCount)
        val tunnel = env.tunnels.tunnels.single()
        assertEquals(7, tunnel.id)
        assertEquals(existing, tunnel)
        assertEquals(7, env.managed.getByDevice("device-1").single().tunnelId)
    }

    @Test
    fun changedRevisionUpdatesQuickConfigAndKeepsId() = runTest {
        val oldConfig = quickConfig(endpoint = "old.example.com:51820")
        val newConfig = quickConfig(endpoint = "new.example.com:51820")
        val existing =
            TunnelConfig(
                id = 7,
                name = "Pixel",
                quickConfig = oldConfig,
                position = 3,
                isMetered = true,
                groupId = 5,
            )
        val binding =
            ManagedTunnel(
                deviceId = "device-1",
                tunnelId = 7,
                deviceName = "Pixel",
                interfaceId = "iface-1",
                endpoint = "old.example.com:51820",
                revision = "rev-1",
                syncedAt = 1L,
            )
        val env =
            syncEnvironment(
                tunnels = listOf(existing),
                bindings = listOf(binding),
                configure = {
                    deviceConfigResults["device-1"] =
                        AccountResult.Success(
                            deviceConfig(
                                conf = newConfig,
                                revision = "rev-2",
                                endpoint = "new.example.com:51820",
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(updated = 1), result)
        val tunnel = env.tunnels.tunnels.single()
        assertEquals(7, tunnel.id)
        assertEquals(normalizeQuickConfig(newConfig), tunnel.quickConfig)
        assertEquals(3, tunnel.position)
        assertEquals(5, tunnel.groupId)
        assertTrue(tunnel.isMetered)

        val updatedBinding = env.managed.getByDevice("device-1").singleOrNull()
        assertEquals("rev-2", updatedBinding?.revision)
        assertEquals("new.example.com:51820", updatedBinding?.endpoint)
    }

    @Test
    fun revokedDeviceRemovesTunnelAndBinding() = runTest {
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(revoked = true))),
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(removed = 1), result)
        assertTrue(env.tunnels.tunnels.isEmpty())
        assertTrue(env.managed.bindings.isEmpty())
    }

    @Test
    fun missingDeviceRemovesTunnelAndBinding() = runTest {
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(id = "device-2"))),
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
                configure = {
                    deviceConfigResults["device-2"] = AccountResult.Success(deviceConfig())
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(created = 1, removed = 1), result)
        val remaining = env.tunnels.tunnels.single()
        assertEquals("device-2", env.managed.bindings.single().deviceId)
        assertEquals(remaining.id, env.managed.bindings.single().tunnelId)
    }

    @Test
    fun offlineKeepsTunnelsAndBindings() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
            ) {
                bootstrapResult = AccountResult.Failure(AccountError.Network)
            }

        val result = env.service.sync()

        assertEquals(SyncResult.Offline, result)
        assertEquals(1, env.tunnels.tunnels.size)
        assertEquals(1, env.managed.bindings.size)
        assertEquals(0, env.tunnels.deleteCount)
    }

    @Test
    fun apiErrorReturnsFailedAndKeepsTunnels() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
            ) {
                bootstrapResult =
                    AccountResult.Failure(
                        AccountError.Api(status = 500, code = "internal", message = "boom"),
                    )
            }

        val result = env.service.sync()

        assertEquals(SyncResult.Failed("boom"), result)
        assertEquals(1, env.tunnels.tunnels.size)
        assertEquals(1, env.managed.bindings.size)
    }

    @Test
    fun deviceConfigFailureKeepsTunnels() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
                configure = {
                    deviceConfigResults["device-1"] = AccountResult.Failure(AccountError.Network)
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Offline, result)
        assertEquals(1, env.tunnels.tunnels.size)
        assertEquals(1, env.managed.bindings.size)
    }

    @Test
    fun nameConflictAddsSuffix() = runTest {
        val manual = TunnelConfig(id = 9, name = "Pixel", quickConfig = quickConfig())
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = emptyList()),
                tunnels = listOf(manual),
                configure = {
                    createDeviceResult =
                        AccountResult.Success(
                            CreatedDevice(device = accountDevice(), config = deviceConfig()),
                        )
                },
            )

        env.service.sync()

        val imported = env.tunnels.tunnels.single { it.id != manual.id }
        assertEquals("Pixel (2)", imported.name)
        assertEquals("Pixel", env.managed.getByDevice("device-1").single().deviceName)
        assertEquals(9, env.tunnels.findByTunnelName("Pixel")?.id)
    }

    @Test
    fun deviceRenameRenamesTunnelWithUniqueName() = runTest {
        val existing =
            TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig(), position = 2)
        val manual = TunnelConfig(id = 9, name = "New name", quickConfig = quickConfig())
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(name = "New name"))),
                tunnels = listOf(existing, manual),
                bindings = listOf(managedBinding(tunnelId = 7, deviceName = "Pixel")),
                configure = {
                    deviceConfigResults["device-1"] = AccountResult.Success(deviceConfig())
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(updated = 1), result)
        val renamed = env.tunnels.getById(7)
        assertEquals("New name (2)", renamed?.name)
        assertEquals(2, renamed?.position)
        val binding = env.managed.getByDevice("device-1").singleOrNull()
        assertEquals("New name", binding?.deviceName)
        assertEquals("New name", env.tunnels.getById(9)?.name)
    }

    @Test
    fun invalidConfigReturnsFailedWithoutTouchingTunnels() = runTest {
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = emptyList()),
                configure = {
                    createDeviceResult =
                        AccountResult.Success(
                            CreatedDevice(
                                device = accountDevice(),
                                config = deviceConfig(conf = "not a wireguard config"),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertTrue(result is SyncResult.Failed)
        assertTrue(env.tunnels.tunnels.isEmpty())
        assertTrue(env.managed.bindings.isEmpty())
    }

    @Test
    fun sessionExpiredReturnsTypedResult() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
            ) {
                bootstrapResult = AccountResult.Failure(AccountError.SessionExpired)
            }

        val result = env.service.sync()

        assertEquals(SyncResult.SessionExpired, result)
        assertEquals(1, env.tunnels.tunnels.size)
    }

    @Test
    fun blankServerUrlIsNotConfigured() = runTest {
        val env = syncEnvironment(serverUrl = "")

        val result = env.service.sync()

        assertEquals(SyncResult.NotConfigured, result)
        assertEquals(0, env.account.bootstrapCalls)
    }

    @Test
    fun inactiveSessionIsNotConfigured() = runTest {
        val env = syncEnvironment(session = SessionState.LoggedOut)

        val result = env.service.sync()

        assertEquals(SyncResult.NotConfigured, result)
        assertEquals(0, env.account.bootstrapCalls)
        assertNull(env.managed.bindings.firstOrNull())
    }

    @Test
    fun manualTunnelsAreNeverDeleted() = runTest {
        val manual = TunnelConfig(id = 42, name = "Manual", quickConfig = quickConfig())
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(revoked = true))),
                tunnels = listOf(manual),
                bindings = listOf(managedBinding(tunnelId = 7)),
            )

        env.service.sync()

        assertEquals(manual, env.tunnels.getById(42))
        assertEquals(0, env.tunnels.deleteCount)
    }

    @Test
    fun multipleConfigsCreateTunnelPerInterface() = runTest {
        val firstConf = quickConfig()
        val secondConf = quickConfig(endpoint = "second.example.com:51820", address = "10.8.0.3/32")
        val env =
            syncEnvironment(
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    conf = secondConf,
                                    revision = "rev-2",
                                    endpoint = "second.example.com:51820",
                                    interfaceId = "iface-2",
                                    interfaceName = "awg1",
                                ),
                                deviceConfig(
                                    conf = firstConf,
                                    revision = "rev-1",
                                    interfaceId = "iface-1",
                                    interfaceName = "awg0",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(created = 2), result)
        assertEquals(
            setOf("iface-1", "iface-2"),
            env.managed.getByDevice("device-1").map { it.interfaceId }.toSet(),
        )
        assertEquals(setOf("Pixel", "Pixel · awg1"), env.tunnels.tunnels.map { it.name }.toSet())
        val primary = env.managed.getByDevice("device-1").single { it.interfaceId == "iface-1" }
        val secondary = env.managed.getByDevice("device-1").single { it.interfaceId == "iface-2" }
        assertEquals("rev-1", primary.revision)
        assertEquals("rev-2", secondary.revision)
        assertEquals("Pixel", env.tunnels.getById(primary.tunnelId)?.name)
        assertEquals("Pixel · awg1", env.tunnels.getById(secondary.tunnelId)?.name)
        assertEquals(
            primary.tunnelId,
            env.tunnels.tunnels.minByOrNull { it.position }?.id,
        )
    }

    @Test
    fun revisionChangeUpdatesOnlyAffectedInterface() = runTest {
        val firstConf = quickConfig()
        val oldSecondConf = quickConfig(endpoint = "old.example.com:51820")
        val newSecondConf = quickConfig(endpoint = "new.example.com:51820")
        val env =
            syncEnvironment(
                tunnels =
                    listOf(
                        TunnelConfig(
                            id = 7,
                            name = "Pixel",
                            quickConfig = normalizeQuickConfig(firstConf),
                            position = 0,
                        ),
                        TunnelConfig(
                            id = 8,
                            name = "Pixel · awg1",
                            quickConfig = normalizeQuickConfig(oldSecondConf),
                            position = 1,
                        ),
                    ),
                bindings =
                    listOf(
                        managedBinding(tunnelId = 7, interfaceId = "iface-1", revision = "rev-1"),
                        managedBinding(
                            tunnelId = 8,
                            interfaceId = "iface-2",
                            revision = "rev-2",
                            deviceName = "Pixel",
                        ),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(conf = firstConf, revision = "rev-1"),
                                deviceConfig(
                                    conf = newSecondConf,
                                    revision = "rev-3",
                                    endpoint = "new.example.com:51820",
                                    interfaceId = "iface-2",
                                    interfaceName = "awg1",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(updated = 1), result)
        assertEquals(normalizeQuickConfig(firstConf), env.tunnels.getById(7)?.quickConfig)
        assertEquals(normalizeQuickConfig(newSecondConf), env.tunnels.getById(8)?.quickConfig)
        assertEquals(
            "rev-3",
            env.managed.getByDevice("device-1").single { it.interfaceId == "iface-2" }.revision,
        )
        assertEquals(
            "rev-1",
            env.managed.getByDevice("device-1").single { it.interfaceId == "iface-1" }.revision,
        )
    }

    @Test
    fun removedInterfaceDeletesOnlyItsTunnel() = runTest {
        val firstConf = quickConfig()
        val secondConf = quickConfig(endpoint = "second.example.com:51820")
        val env =
            syncEnvironment(
                tunnels =
                    listOf(
                        TunnelConfig(
                            id = 7,
                            name = "Pixel",
                            quickConfig = normalizeQuickConfig(firstConf),
                        ),
                        TunnelConfig(
                            id = 8,
                            name = "Pixel · awg1",
                            quickConfig = normalizeQuickConfig(secondConf),
                        ),
                    ),
                bindings =
                    listOf(
                        managedBinding(tunnelId = 7, interfaceId = "iface-1"),
                        managedBinding(tunnelId = 8, interfaceId = "iface-2"),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    conf = secondConf,
                                    revision = "rev-1",
                                    endpoint = "second.example.com:51820",
                                    interfaceId = "iface-2",
                                    interfaceName = "awg1",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(updated = 1, removed = 1), result)
        assertEquals(listOf(8), env.tunnels.tunnels.map { it.id })
        assertEquals("Pixel", env.tunnels.getById(8)?.name)
        assertEquals(
            listOf("iface-2"),
            env.managed.getByDevice("device-1").map { it.interfaceId },
        )
    }

    @Test
    fun repeatedSyncWithoutChangesDoesNothing() = runTest {
        val firstConf = quickConfig()
        val secondConf = quickConfig(endpoint = "second.example.com:51820")
        val env =
            syncEnvironment(
                tunnels =
                    listOf(
                        TunnelConfig(
                            id = 7,
                            name = "Pixel",
                            quickConfig = normalizeQuickConfig(firstConf),
                            position = 0,
                        ),
                        TunnelConfig(
                            id = 8,
                            name = "Pixel · awg1",
                            quickConfig = normalizeQuickConfig(secondConf),
                            position = 1,
                        ),
                    ),
                bindings =
                    listOf(
                        managedBinding(tunnelId = 7, interfaceId = "iface-1"),
                        managedBinding(tunnelId = 8, interfaceId = "iface-2"),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(conf = firstConf, revision = "rev-1"),
                                deviceConfig(
                                    conf = secondConf,
                                    revision = "rev-1",
                                    endpoint = "second.example.com:51820",
                                    interfaceId = "iface-2",
                                    interfaceName = "awg1",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(), result)
        assertEquals(0, env.tunnels.saveCount)
        assertEquals(0, env.tunnels.deleteCount)
        assertEquals(2, env.managed.bindings.size)
    }

    @Test
    fun legacyBindingWithoutInterfaceIsReusedForPrimaryConfig() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings =
                    listOf(
                        ManagedTunnel(
                            deviceId = "device-1",
                            tunnelId = 7,
                            deviceName = "Pixel",
                            interfaceId = "",
                            endpoint = "vpn.example.com:51820",
                            revision = "rev-1",
                            syncedAt = 1L,
                        ),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(interfaceId = "iface-1", interfaceName = "awg0"),
                                deviceConfig(
                                    conf = quickConfig(endpoint = "second.example.com:51820"),
                                    revision = "rev-2",
                                    endpoint = "second.example.com:51820",
                                    interfaceId = "iface-2",
                                    interfaceName = "awg1",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(created = 1), result)
        val bindings = env.managed.getByDevice("device-1")
        assertEquals(setOf("iface-1", "iface-2"), bindings.map { it.interfaceId }.toSet())
        assertEquals(7, bindings.single { it.interfaceId == "iface-1" }.tunnelId)
        assertEquals(2, env.tunnels.tunnels.size)
        assertEquals(setOf("Pixel", "Pixel · awg1"), env.tunnels.tunnels.map { it.name }.toSet())
    }

    @Test
    fun twoPeersOnSameInterfaceCreateTwoTunnels() = runTest {
        val primaryConf = quickConfig()
        val secondConf = quickConfig(endpoint = "second.example.com:51820", address = "10.8.0.3/32")
        val env = syncEnvironment {
            deviceConfigsResults["device-1"] =
                AccountResult.Success(
                    listOf(
                        deviceConfig(
                            conf = primaryConf,
                            revision = "rev-1",
                            peerId = "peer-1",
                            label = "primary",
                        ),
                        deviceConfig(
                            conf = secondConf,
                            revision = "rev-2",
                            endpoint = "second.example.com:51820",
                            peerId = "peer-2",
                            label = "secondary",
                        ),
                    ),
                )
        }

        val result = env.service.sync()

        assertEquals(SyncResult.Success(created = 2), result)
        val bindings = env.managed.getByDevice("device-1")
        assertEquals(setOf("peer-1", "peer-2"), bindings.map { it.peerId }.toSet())
        assertEquals(setOf("iface-1"), bindings.map { it.interfaceId }.toSet())
        assertEquals(setOf("primary", "secondary"), bindings.map { it.label }.toSet())
        assertEquals(
            setOf("Pixel", "Pixel · secondary"),
            env.tunnels.tunnels.map { it.name }.toSet(),
        )
        val primary = bindings.single { it.peerId == "peer-1" }
        val secondary = bindings.single { it.peerId == "peer-2" }
        assertEquals("Pixel", env.tunnels.getById(primary.tunnelId)?.name)
        assertEquals("Pixel · secondary", env.tunnels.getById(secondary.tunnelId)?.name)
        assertEquals("rev-1", primary.revision)
        assertEquals("rev-2", secondary.revision)
    }

    @Test
    fun duplicatePeerLabelsGetUniqueNames() = runTest {
        val secondConf = quickConfig(endpoint = "second.example.com:51820")
        val thirdConf = quickConfig(endpoint = "third.example.com:51820")
        val env = syncEnvironment {
            deviceConfigsResults["device-1"] =
                AccountResult.Success(
                    listOf(
                        deviceConfig(peerId = "peer-1", label = "awg0"),
                        deviceConfig(
                            conf = secondConf,
                            revision = "rev-2",
                            endpoint = "second.example.com:51820",
                            peerId = "peer-2",
                            label = "awg0",
                        ),
                        deviceConfig(
                            conf = thirdConf,
                            revision = "rev-3",
                            endpoint = "third.example.com:51820",
                            peerId = "peer-3",
                            label = "awg0",
                        ),
                    ),
                )
        }

        env.service.sync()

        assertEquals(3, env.tunnels.tunnels.size)
        assertEquals(
            setOf("Pixel", "Pixel · awg0", "Pixel · awg0 (2)"),
            env.tunnels.tunnels.map { it.name }.toSet(),
        )
    }

    @Test
    fun revisionChangeUpdatesOnlyAffectedPeer() = runTest {
        val firstConf = quickConfig()
        val oldSecondConf = quickConfig(endpoint = "old.example.com:51820")
        val newSecondConf = quickConfig(endpoint = "new.example.com:51820")
        val env =
            syncEnvironment(
                tunnels =
                    listOf(
                        TunnelConfig(
                            id = 7,
                            name = "Pixel",
                            quickConfig = normalizeQuickConfig(firstConf),
                            position = 0,
                        ),
                        TunnelConfig(
                            id = 8,
                            name = "Pixel · second",
                            quickConfig = normalizeQuickConfig(oldSecondConf),
                            position = 1,
                        ),
                    ),
                bindings =
                    listOf(
                        managedBinding(
                            tunnelId = 7,
                            interfaceId = "iface-1",
                            peerId = "peer-1",
                            revision = "rev-1",
                        ),
                        managedBinding(
                            tunnelId = 8,
                            interfaceId = "iface-1",
                            peerId = "peer-2",
                            revision = "rev-2",
                            label = "second",
                        ),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    conf = firstConf,
                                    revision = "rev-1",
                                    peerId = "peer-1",
                                ),
                                deviceConfig(
                                    conf = newSecondConf,
                                    revision = "rev-3",
                                    endpoint = "new.example.com:51820",
                                    peerId = "peer-2",
                                    label = "second",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(updated = 1), result)
        assertEquals(normalizeQuickConfig(firstConf), env.tunnels.getById(7)?.quickConfig)
        assertEquals(normalizeQuickConfig(newSecondConf), env.tunnels.getById(8)?.quickConfig)
        assertEquals(
            "rev-1",
            env.managed.getByDevice("device-1").single { it.peerId == "peer-1" }.revision,
        )
        assertEquals(
            "rev-3",
            env.managed.getByDevice("device-1").single { it.peerId == "peer-2" }.revision,
        )
    }

    @Test
    fun removingOnePeerKeepsTheOtherTunnel() = runTest {
        val firstConf = quickConfig()
        val secondConf = quickConfig(endpoint = "second.example.com:51820")
        val env =
            syncEnvironment(
                tunnels =
                    listOf(
                        TunnelConfig(
                            id = 7,
                            name = "Pixel",
                            quickConfig = normalizeQuickConfig(firstConf),
                        ),
                        TunnelConfig(
                            id = 8,
                            name = "Pixel · second",
                            quickConfig = normalizeQuickConfig(secondConf),
                        ),
                    ),
                bindings =
                    listOf(
                        managedBinding(
                            tunnelId = 7,
                            interfaceId = "iface-1",
                            peerId = "peer-1",
                        ),
                        managedBinding(
                            tunnelId = 8,
                            interfaceId = "iface-1",
                            peerId = "peer-2",
                            label = "second",
                        ),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    conf = firstConf,
                                    revision = "rev-1",
                                    peerId = "peer-1",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(removed = 1), result)
        assertEquals(listOf(7), env.tunnels.tunnels.map { it.id })
        assertEquals(
            listOf("peer-1"),
            env.managed.getByDevice("device-1").map { it.peerId },
        )
    }

    @Test
    fun legacyBindingWithoutPeerIsReusedForPrimaryPeer() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings =
                    listOf(
                        ManagedTunnel(
                            deviceId = "device-1",
                            tunnelId = 7,
                            deviceName = "Pixel",
                            interfaceId = "iface-1",
                            endpoint = "vpn.example.com:51820",
                            revision = "rev-1",
                            syncedAt = 1L,
                            peerId = "",
                        ),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    revision = "rev-1",
                                    peerId = "peer-1",
                                    label = "primary",
                                ),
                            ),
                        )
                },
            )

        val result = env.service.sync()

        assertEquals(SyncResult.Success(), result)
        val binding = env.managed.getByDevice("device-1").single()
        assertEquals(7, binding.tunnelId)
        assertEquals("peer-1", binding.peerId)
        assertEquals("primary", binding.label)
        assertEquals(listOf(7), env.tunnels.tunnels.map { it.id })
    }

    private fun managedBinding(
        tunnelId: Int,
        deviceId: String = "device-1",
        deviceName: String = "Pixel",
        interfaceId: String = "iface-1",
        revision: String = "rev-1",
        peerId: String = "",
        label: String = "",
    ): ManagedTunnel =
        ManagedTunnel(
            deviceId = deviceId,
            tunnelId = tunnelId,
            deviceName = deviceName,
            interfaceId = interfaceId,
            endpoint = "vpn.example.com:51820",
            revision = revision,
            syncedAt = 1L,
            peerId = peerId,
            label = label,
        )
}
