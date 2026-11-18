package space.ivlev.umbravpn.sync

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncEvent
import space.ivlev.umbravpn.domain.sync.SyncRemovalReason

@OptIn(ExperimentalCoroutinesApi::class)
class SyncEventTest {

    @Test
    fun initialImportEmitsNoEvents() = runTest {
        val env =
            syncEnvironment(snapshot = accountSnapshot(devices = emptyList())) {
                createDeviceResult =
                    AccountResult.Success(
                        CreatedDevice(device = accountDevice(), config = deviceConfig()),
                    )
            }
        val events = collectEvents(env.service)

        env.service.sync()

        assertTrue(events.toString(), events.isEmpty())
    }

    @Test
    fun unchangedSyncEmitsNoEvents() = runTest {
        val env =
            syncEnvironment(
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
                configure = {
                    deviceConfigsResults["device-1"] = AccountResult.Success(listOf(deviceConfig()))
                },
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertTrue(events.toString(), events.isEmpty())
    }

    @Test
    fun updatedTunnelEmitsUpdatedEventWithName() = runTest {
        val existing =
            TunnelConfig(
                id = 7,
                name = "Pixel",
                quickConfig = quickConfig(endpoint = "old.example.com:51820"),
            )
        val env =
            syncEnvironment(
                tunnels = listOf(existing),
                bindings = listOf(managedBinding(tunnelId = 7, revision = "rev-1")),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(
                                deviceConfig(
                                    conf = quickConfig(endpoint = "new.example.com:51820"),
                                    revision = "rev-2",
                                    endpoint = "new.example.com:51820",
                                ),
                            ),
                        )
                },
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertEquals(
            listOf<SyncEvent>(SyncEvent.Updated(count = 1, names = listOf("Pixel"))),
            events,
        )
    }

    @Test
    fun renamedTunnelEmitsUpdatedEventWithNewName() = runTest {
        val existing =
            TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig(), position = 0)
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(name = "Renamed"))),
                tunnels = listOf(existing),
                bindings = listOf(managedBinding(tunnelId = 7)),
                configure = {
                    deviceConfigsResults["device-1"] = AccountResult.Success(listOf(deviceConfig()))
                },
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertEquals(listOf<SyncEvent>(SyncEvent.Updated(1, listOf("Renamed"))), events)
    }

    @Test
    fun removedPeerEmitsRemovedEventWithPeerRemovalReason() = runTest {
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
                        managedBinding(tunnelId = 7, peerId = "peer-1"),
                        managedBinding(tunnelId = 8, peerId = "peer-2", label = "second"),
                    ),
                configure = {
                    deviceConfigsResults["device-1"] =
                        AccountResult.Success(
                            listOf(deviceConfig(conf = firstConf, peerId = "peer-1")),
                        )
                },
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertEquals(
            listOf<SyncEvent>(
                SyncEvent.Removed(
                    count = 1,
                    names = listOf("Pixel · second"),
                    reason = SyncRemovalReason.PeerRemoved,
                ),
            ),
            events,
        )
    }

    @Test
    fun revokedDeviceEmitsRemovedEventWithRevokedReason() = runTest {
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(revoked = true))),
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertEquals(
            listOf<SyncEvent>(
                SyncEvent.Removed(
                    count = 1,
                    names = listOf("Pixel"),
                    reason = SyncRemovalReason.Revoked,
                ),
            ),
            events,
        )
    }

    @Test
    fun deletedDeviceEmitsRemovedEventWithDeletedReason() = runTest {
        val env =
            syncEnvironment(
                snapshot = accountSnapshot(devices = listOf(accountDevice(id = "device-2"))),
                tunnels = listOf(TunnelConfig(id = 7, name = "Pixel", quickConfig = quickConfig())),
                bindings = listOf(managedBinding(tunnelId = 7)),
                configure = {
                    deviceConfigsResults["device-2"] =
                        AccountResult.Success(listOf(deviceConfig(conf = quickConfig())))
                },
            )
        val events = collectEvents(env.service)

        env.service.sync()

        assertEquals(
            listOf<SyncEvent>(
                SyncEvent.Removed(
                    count = 1,
                    names = listOf("Pixel"),
                    reason = SyncRemovalReason.Deleted,
                ),
            ),
            events,
        )
    }

    private fun TestScope.collectEvents(service: ManagedTunnelSyncService): List<SyncEvent> {
        val events = mutableListOf<SyncEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            service.events.toList(events)
        }
        return events
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
