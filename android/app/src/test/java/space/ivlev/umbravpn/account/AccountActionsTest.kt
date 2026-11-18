package space.ivlev.umbravpn.account

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult

class AccountActionsTest {
    private val repository = FakeAccountRepository()
    private val actions = AccountActions(repository)

    @Test
    fun bootstrapReturnsSnapshotAndFormatsQuota() = runTest {
        val snapshot = (actions.bootstrap() as ActionResult.Success).value

        assertEquals("alice@example.com", snapshot.user.email)
        assertEquals(1, snapshot.devices.size)
        assertEquals("5 GB / 100 GB", AccountFormat.quotaUsed(snapshot.quota))
        assertEquals("5%", AccountFormat.percent(AccountFormat.quotaPercent(snapshot.quota)))
        assertEquals(1, repository.bootstrapCalls)
    }

    @Test
    fun bootstrapNetworkFailureIsReported() = runTest {
        repository.bootstrapResult = AccountResult.Failure(AccountError.Network)

        val outcome = actions.bootstrap()

        assertEquals(AccountMessage.Network, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun createDeviceSendsTrimmedName() = runTest {
        val created = (actions.createDevice("  Laptop  ") as ActionResult.Success).value

        assertEquals("Laptop", repository.createdNames.single())
        assertEquals("device-new", created.device.id)
        assertEquals("vpn.example.com:51820", created.config.endpoint)
    }

    @Test
    fun createDevicePassesSelectedInterfaces() = runTest {
        actions.createDevice("Laptop", listOf("iface-1", "iface-2", "iface-1"))

        assertEquals(listOf(listOf("iface-1", "iface-2")), repository.createdInterfaceIds)
    }

    @Test
    fun createDeviceWithoutInterfacesSendsEmptySelection() = runTest {
        actions.createDevice("Laptop")

        assertEquals(listOf(emptyList<String>()), repository.createdInterfaceIds)
    }

    @Test
    fun createDevicePassesIdempotencyKey() = runTest {
        actions.createDevice("Laptop", emptyList(), "key-1")

        assertEquals(listOf<String?>("key-1"), repository.createdIdempotencyKeys)
    }

    @Test
    fun createDeviceWithoutIdempotencyKeyPassesNull() = runTest {
        actions.createDevice("Laptop")

        assertEquals(listOf<String?>(null), repository.createdIdempotencyKeys)
    }

    @Test
    fun createDeviceRejectsBlankNameWithoutRequest() = runTest {
        val outcome = actions.createDevice("   ")

        assertEquals(AccountMessage.EmptyDeviceName, (outcome as ActionResult.Failure).message)
        assertTrue(repository.createdNames.isEmpty())
    }

    @Test
    fun createDeviceLimitConflictIsReported() = runTest {
        repository.createResult =
            AccountResult.Failure(AccountError.Api(409, "conflict", "at most 3 devices"))

        val outcome = actions.createDevice("Tablet")

        assertEquals(AccountMessage.DeviceLimitReached, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun createDeviceTariffRequiredIsReported() = runTest {
        repository.createResult =
            AccountResult.Failure(AccountError.Api(409, "tariff_required", "no tariff"))

        val outcome = actions.createDevice("Tablet")

        assertEquals(AccountMessage.TariffRequired, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun createDeviceSubscriptionInactiveIsReported() = runTest {
        repository.createResult = AccountResult.Failure(AccountError.SubscriptionInactive)

        val outcome = actions.createDevice("Tablet")

        assertEquals(
            AccountMessage.SubscriptionInactive,
            (outcome as ActionResult.Failure).message,
        )
    }

    @Test
    fun renameDeviceReturnsUpdatedDevice() = runTest {
        val device = (actions.renameDevice("device-1", " Renamed ") as ActionResult.Success).value

        assertEquals("device-1" to "Renamed", repository.renamed.single())
        assertEquals("Renamed", device.name)
    }

    @Test
    fun deleteDeviceReportsSuccess() = runTest {
        assertTrue(actions.deleteDevice("device-1") is ActionResult.Success)
        assertEquals("device-1", repository.deleted.single())
    }

    @Test
    fun deviceEndpointIsFetchedFromConfig() = runTest {
        val endpoint = (actions.deviceEndpoint("device-1") as ActionResult.Success).value

        assertEquals("vpn.example.com:51820", endpoint)
    }

    @Test
    fun deviceEndpointFailureIsReported() = runTest {
        repository.configResult = AccountResult.Failure(AccountError.Api(404, "not_found", "gone"))

        val outcome = actions.deviceEndpoint("device-1")

        assertEquals(AccountMessage.NotFound, (outcome as ActionResult.Failure).message)
    }

    @Test
    fun quotaPercentFallsBackToBytesWhenMissing() = runTest {
        val snapshot = (actions.bootstrap() as ActionResult.Success).value
        assertEquals(
            5.0,
            AccountFormat.quotaPercent(snapshot.quota.copy(percent = null))!!,
            0.001,
        )
    }
}
