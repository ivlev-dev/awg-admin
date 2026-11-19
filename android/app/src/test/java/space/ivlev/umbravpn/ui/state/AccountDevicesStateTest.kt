package space.ivlev.umbravpn.ui.state

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

class AccountDevicesStateTest {
    @Test
    fun footerIsHiddenBeforeFirstLoad() {
        assertEquals(DeviceListFooter.None, AccountDevicesState().footer)
        assertFalse(AccountDevicesState().canLoadMore)
    }

    @Test
    fun footerShowsLoadMoreWhilePagesRemain() {
        val state =
            AccountDevicesState(
                items = devices(20),
                total = 57,
                offset = 20,
                isLoaded = true,
            )

        assertTrue(state.hasMore)
        assertTrue(state.canLoadMore)
        assertEquals(DeviceListFooter.LoadMore, state.footer)
    }

    @Test
    fun footerShowsLoadingWhileNextPageLoads() {
        val state =
            AccountDevicesState(
                items = devices(20),
                total = 57,
                offset = 20,
                isLoaded = true,
                isLoadingMore = true,
            )

        assertFalse(state.canLoadMore)
        assertEquals(DeviceListFooter.Loading, state.footer)
    }

    @Test
    fun footerShowsErrorAndDisablesLoadingMore() {
        val state =
            AccountDevicesState(
                items = devices(20),
                total = 57,
                offset = 20,
                isLoaded = true,
                error = AccountMessage.Network,
            )

        assertFalse(state.canLoadMore)
        assertEquals(DeviceListFooter.Error, state.footer)
    }

    @Test
    fun footerShowsEndWhenEverythingIsLoaded() {
        val state =
            AccountDevicesState(
                items = devices(7),
                total = 7,
                offset = 7,
                isLoaded = true,
            )

        assertFalse(state.hasMore)
        assertFalse(state.canLoadMore)
        assertEquals(DeviceListFooter.End, state.footer)
    }

    @Test
    fun footerIsHiddenForEmptyList() {
        val state = AccountDevicesState(total = 0, isLoaded = true)

        assertTrue(state.isEmpty)
        assertEquals(DeviceListFooter.None, state.footer)
    }

    @Test
    fun loadingStateDisablesLoadMore() {
        val state =
            AccountDevicesState(
                items = devices(5),
                total = 57,
                offset = 5,
                isLoaded = true,
                isLoading = true,
            )

        assertFalse(state.canLoadMore)
    }

    @Test
    fun previewIsLimitedToFiveDevices() {
        val snapshot =
            AccountSnapshot(
                user = user(),
                tariff = null,
                quota = quota(),
                devices = devices(10),
                devicesTotal = 10,
            )

        val state =
            AccountUiState(
                snapshot = snapshot,
                deviceList = AccountDevicesState(items = devices(20), total = 57, isLoaded = true),
            )

        assertEquals(DEVICE_PREVIEW_LIMIT, state.previewDevices.size)
        assertEquals(57, state.deviceTotal)
    }

    @Test
    fun totalFallsBackToSnapshotWhileDevicesAreNotLoaded() {
        val snapshot =
            AccountSnapshot(
                user = user(),
                tariff = null,
                quota = quota(),
                devices = devices(3),
                devicesTotal = 42,
            )

        val state = AccountUiState(snapshot = snapshot)

        assertEquals(42, state.deviceTotal)
        assertEquals(3, state.previewDevices.size)
    }

    private fun devices(count: Int): List<AccountDevice> =
        (1..count).map { index ->
            AccountDevice(
                id = "device-$index",
                userId = "user-1",
                groupId = null,
                interfaceId = "iface-1",
                interfaceName = "awg0",
                nodeId = "node-1",
                nodeName = "Frankfurt",
                name = "Device $index",
                downKbps = 0,
                upKbps = 0,
                revoked = false,
                external = false,
                addresses = listOf("10.8.0.2/32"),
                peers = emptyList(),
                createdAt = Instant.parse("2026-01-03T09:00:00Z"),
            )
        }

    private fun user(): AuthUser =
        AuthUser(
            id = "user-1",
            fullName = "Alice Ivanova",
            email = "alice@example.com",
            status = UserStatus.Active,
            totpEnabled = false,
            role = UserRole.User,
        )

    private fun quota(): AccountQuota =
        AccountQuota(
            usedBytes = 0,
            quotaBytes = null,
            exceeded = false,
            remainingBytes = null,
            percent = null,
            periodStart = null,
            periodEnd = null,
            resetAt = null,
        )
}
