package space.ivlev.umbravpn.account

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DevicePeer

class AccountTunnelActionsTest {
    private val repository = FakeAccountRepository()
    private val actions = AccountActions(repository)

    @Test
    fun addTunnelTrimsLabelAndPassesInterface() = runTest {
        val device =
            testDevice(
                peers =
                    listOf(
                        DevicePeer(interfaceId = "iface-1", interfaceName = "awg0"),
                        DevicePeer(
                            interfaceId = "iface-1",
                            interfaceName = "awg0",
                            peerId = "peer-2",
                            label = "extra",
                        ),
                    ),
            )
        repository.addTunnelResult =
            AccountResult.Success(
                CreatedDevice(
                    device = device,
                    config = config(peerId = "peer-1", label = "primary"),
                    configs =
                        listOf(
                            config(peerId = "peer-1", label = "primary"),
                            config(peerId = "peer-2", label = "extra"),
                        ),
                ),
            )

        val outcome =
            actions.addDeviceTunnel(
                deviceId = "device-1",
                interfaceId = "iface-1",
                label = "  extra  ",
                idempotencyKey = "key-1",
            )

        assertTrue(outcome is ActionResult.Success)
        assertEquals(
            listOf(Triple("device-1", "iface-1", "extra")),
            repository.addedTunnels,
        )
        assertEquals(listOf<String?>("key-1"), repository.addedTunnelKeys)
    }

    @Test
    fun addTunnelRejectsBlankInterfaceWithoutCallingBackend() = runTest {
        val outcome = actions.addDeviceTunnel(deviceId = "device-1", interfaceId = " ")

        assertTrue(outcome is ActionResult.Failure)
        assertEquals(AccountMessage.EmptyInterface, (outcome as ActionResult.Failure).message)
        assertTrue(repository.addedTunnels.isEmpty())
    }

    @Test
    fun removeTunnelConflictMapsToLastTunnelMessage() = runTest {
        repository.removeTunnelResult =
            AccountResult.Failure(
                AccountError.Api(
                    status = 409,
                    code = "conflict",
                    message = "device must keep at least one peer",
                ),
            )

        val outcome = actions.removeDeviceTunnel("device-1", "peer-1")

        assertTrue(outcome is ActionResult.Failure)
        assertEquals(AccountMessage.LastTunnel, (outcome as ActionResult.Failure).message)
        assertEquals(listOf("device-1" to "peer-1"), repository.removedTunnels)
    }

    @Test
    fun removeTunnelRejectsBlankPeerId() = runTest {
        val outcome = actions.removeDeviceTunnel("device-1", "")

        assertTrue(outcome is ActionResult.Failure)
        assertEquals(AccountMessage.NotFound, (outcome as ActionResult.Failure).message)
        assertTrue(repository.removedTunnels.isEmpty())
    }

    private fun config(peerId: String, label: String): DeviceConfig =
        DeviceConfig(
            interfaceId = "iface-1",
            interfaceName = "awg0",
            nodeId = "node-1",
            endpoint = "vpn.example.com:51820",
            addresses = listOf("10.8.0.2/32"),
            conf = "[Interface]",
            revision = "rev",
            peerId = peerId,
            label = label,
        )
}
