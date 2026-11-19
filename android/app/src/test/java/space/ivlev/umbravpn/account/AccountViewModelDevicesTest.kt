package space.ivlev.umbravpn.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.ui.state.DEVICE_PREVIEW_LIMIT
import space.ivlev.umbravpn.ui.state.DeviceListFooter
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelDevicesTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val harness = AccountViewModelHarness()
    private val repository = harness.repository
    private val viewModel: AccountViewModel by lazy { harness.build() }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        Orbit.configureDefaults {
            eventLoopDispatcher = { dispatcher }
            intentLaunchingDispatcher = { dispatcher }
        }
    }

    @After
    fun tearDown() {
        Orbit.resetDefaults()
        Dispatchers.resetMain()
    }

    @Test
    fun initialLoadFillsFirstPageAndTotal() =
        runTest(dispatcher) {
            repository.bootstrapResult = AccountResult.Success(testSnapshot(devices = devices(2)))
            repository.pageResult =
                AccountResult.Success(
                    Page(items = devices(20), total = 57, limit = 20, offset = 0),
                )

            viewModel.retry()
            settle()

            val list = state().deviceList
            assertEquals(20, list.items.size)
            assertEquals(57, list.total)
            assertEquals(20, list.limit)
            assertEquals(20, list.offset)
            assertTrue(list.isLoaded)
            assertTrue(list.hasMore)
            assertEquals(DeviceListFooter.LoadMore, list.footer)
            assertEquals(57, state().deviceTotal)
            assertEquals(DEVICE_PREVIEW_LIMIT, state().previewDevices.size)

            val request = repository.pageQueries.single()
            assertEquals(20, request.limit)
            assertEquals(0, request.offset)
            assertEquals("", request.query)
            assertEquals(DeviceStatusFilter.All, request.status)
        }

    @Test
    fun mergedDevicesContainSnapshotAndPageEntriesWithoutDuplicates() =
        runTest(dispatcher) {
            repository.bootstrapResult =
                AccountResult.Success(
                    testSnapshot(devices = listOf(testDevice(id = "device-1"))),
                )
            repository.pageResult =
                AccountResult.Success(
                    Page(
                        items = listOf(testDevice(id = "device-1"), testDevice(id = "device-2")),
                        total = 2,
                        limit = 20,
                        offset = 0,
                    ),
                )

            viewModel.retry()
            settle()

            assertEquals(listOf("device-1", "device-2"), state().devices.map { it.id })
        }

    @Test
    fun setDevicesQueryDebouncesAndSendsSingleRequest() =
        runTest(dispatcher) {
            loadInitial()
            repository.pageQueries.clear()

            viewModel.setDevicesQuery("p")
            dispatcher.scheduler.advanceTimeBy(100)
            viewModel.setDevicesQuery("pix")
            dispatcher.scheduler.advanceTimeBy(100)
            viewModel.setDevicesQuery("pixel")

            assertTrue(repository.pageQueries.isEmpty())
            assertEquals("pixel", state().deviceList.query)

            settle()

            assertEquals(1, repository.pageQueries.size)
            assertEquals("pixel", repository.pageQueries.single().query)
            assertEquals(0, repository.pageQueries.single().offset)
        }

    @Test
    fun setDevicesQueryIgnoresRepeatedValue() =
        runTest(dispatcher) {
            loadInitial()
            repository.pageQueries.clear()

            viewModel.setDevicesQuery("pixel")
            settle()
            viewModel.setDevicesQuery("pixel")
            settle()

            assertEquals(1, repository.pageQueries.size)
        }

    @Test
    fun setDevicesStatusReloadsFirstPageWithServerFilter() =
        runTest(dispatcher) {
            loadInitial()
            repository.pageQueries.clear()

            viewModel.setDevicesStatus(DeviceStatusFilter.Revoked)
            settle()

            val request = repository.pageQueries.single()
            assertEquals(DeviceStatusFilter.Revoked, request.status)
            assertEquals(0, request.offset)
        }

    @Test
    fun loadMoreAppendsNextPageWithoutDuplicates() =
        runTest(dispatcher) {
            val all = devices(25)
            repository.pageHandler = { query ->
                AccountResult.Success(
                    Page(
                        items = all.drop(query.offset).take(query.limit),
                        total = all.size,
                        limit = query.limit,
                        offset = query.offset,
                    ),
                )
            }
            loadInitial()
            assertEquals(20, state().deviceList.items.size)

            repository.pageHandler = { query ->
                val start = (query.offset - 1).coerceAtLeast(0)
                AccountResult.Success(
                    Page(
                        items = all.drop(start).take(query.limit),
                        total = all.size,
                        limit = query.limit,
                        offset = start,
                    ),
                )
            }
            viewModel.loadMoreDevices()
            settle()

            val list = state().deviceList
            assertEquals(25, list.items.size)
            assertEquals(25, list.items.map { it.id }.distinct().size)
            assertEquals(25, list.offset)
            assertEquals(25, list.total)
            assertEquals(DeviceListFooter.End, list.footer)
        }

    @Test
    fun loadMoreDoesNothingWhenAllDevicesLoaded() =
        runTest(dispatcher) {
            repository.pageHandler = {
                AccountResult.Success(Page(items = devices(3), total = 3, limit = 20, offset = 0))
            }
            loadInitial()
            val calls = repository.pageQueries.size

            viewModel.loadMoreDevices()
            settle()

            assertEquals(calls, repository.pageQueries.size)
            assertEquals(DeviceListFooter.End, state().deviceList.footer)
        }

    @Test
    fun emptyPageStopsPagination() =
        runTest(dispatcher) {
            repository.bootstrapResult = AccountResult.Success(testSnapshot(devices = devices(20)))
            repository.pageHandler = { query ->
                val items = if (query.offset == 0) devices(20) else emptyList()
                AccountResult.Success(
                    Page(
                        items = items,
                        total = 100,
                        limit = query.limit,
                        offset = query.offset,
                    ),
                )
            }
            viewModel.retry()
            settle()
            assertTrue(state().deviceList.hasMore)

            viewModel.loadMoreDevices()
            settle()

            assertEquals(20, state().deviceList.items.size)
            assertTrue(!state().deviceList.hasMore)
            assertEquals(DeviceListFooter.End, state().deviceList.footer)
        }

    @Test
    fun pageFailureSeedsDevicesFromSnapshotAndKeepsError() =
        runTest(dispatcher) {
            repository.bootstrapResult = AccountResult.Success(testSnapshot(devices = devices(3)))
            repository.pageResult = AccountResult.Failure(AccountError.Network)

            viewModel.retry()
            settle()

            val list = state().deviceList
            assertEquals(3, list.items.size)
            assertTrue(list.isLoaded)
            assertEquals(AccountMessage.Network, list.error)
            assertEquals(DeviceListFooter.Error, list.footer)
        }

    @Test
    fun renameDeviceUpdatesPageEntryAndSnapshot() =
        runTest(dispatcher) {
            repository.bootstrapResult =
                AccountResult.Success(
                    testSnapshot(devices = listOf(testDevice(id = "device-1", name = "Pixel"))),
                )
            repository.pageResult =
                AccountResult.Success(
                    Page(
                        items = listOf(testDevice(id = "device-1", name = "Pixel")),
                        total = 1,
                        limit = 20,
                        offset = 0,
                    ),
                )
            loadConfigured()
            repository.renameResult =
                AccountResult.Success(testDevice(id = "device-1", name = "Laptop"))

            viewModel.showRenameDevice("device-1", "Pixel")
            settle()
            viewModel.renameDevice("device-1", "Laptop")
            settle()

            assertEquals("Laptop", state().deviceList.items.single().name)
            assertEquals("Laptop", state().snapshot?.devices?.single()?.name)
            assertEquals(1, state().deviceList.total)
        }

    @Test
    fun deleteDeviceRemovesPageEntryAndDecrementsTotal() =
        runTest(dispatcher) {
            val devices = listOf(testDevice(id = "device-1"), testDevice(id = "device-2"))
            repository.bootstrapResult = AccountResult.Success(testSnapshot(devices = devices))
            repository.pageResult =
                AccountResult.Success(Page(items = devices, total = 5, limit = 20, offset = 0))
            loadConfigured()

            viewModel.showDeleteDevice("device-1", "Pixel")
            settle()
            viewModel.deleteDevice("device-1")
            settle()

            assertEquals(listOf("device-2"), state().deviceList.items.map { it.id })
            assertEquals(4, state().deviceList.total)
            assertEquals(listOf("device-2"), state().snapshot?.devices?.map { it.id })
        }

    @Test
    fun createDeviceAddsMatchingEntryToLoadedPage() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(
                    Page(
                        items = listOf(testDevice(id = "device-1")),
                        total = 1,
                        limit = 20,
                        offset = 0,
                    ),
                )
            loadConfigured()
            repository.createResult =
                AccountResult.Success(
                    CreatedDevice(
                        device = testDevice(id = "device-9", name = "New"),
                        config =
                            DeviceConfig(
                                interfaceId = "iface-1",
                                interfaceName = "awg0",
                                nodeId = "node-1",
                                endpoint = "vpn.example.com:51820",
                                addresses = listOf("10.8.0.9/32"),
                                conf = "[Interface]",
                                revision = "rev",
                            ),
                    ),
                )

            viewModel.showAddDevice()
            settle()
            viewModel.createDevice("New")
            settle()

            assertEquals(listOf("device-9", "device-1"), state().deviceList.items.map { it.id })
            assertEquals(2, state().deviceList.total)
            assertEquals(2, state().snapshot?.devices?.size)
        }

    @Test
    fun createDeviceHiddenByStatusFilterDoesNotChangeTotal() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(
                    Page(
                        items = listOf(testDevice(id = "device-1", revoked = true)),
                        total = 1,
                        limit = 20,
                        offset = 0,
                    ),
                )
            loadConfigured()
            viewModel.setDevicesStatus(DeviceStatusFilter.Revoked)
            settle()
            repository.createResult =
                AccountResult.Success(
                    CreatedDevice(
                        device = testDevice(id = "device-9", name = "New"),
                        config =
                            DeviceConfig(
                                interfaceId = "iface-1",
                                interfaceName = "awg0",
                                nodeId = "node-1",
                                endpoint = "vpn.example.com:51820",
                                addresses = listOf("10.8.0.9/32"),
                                conf = "[Interface]",
                                revision = "rev",
                            ),
                    ),
                )

            viewModel.showAddDevice()
            settle()
            viewModel.createDevice("New")
            settle()

            assertEquals(listOf("device-1"), state().deviceList.items.map { it.id })
            assertEquals(1, state().deviceList.total)
        }

    @Test
    fun refreshDevicesReloadsFirstPage() =
        runTest(dispatcher) {
            loadInitial()
            repository.pageQueries.clear()

            viewModel.refreshDevices()
            settle()

            val request = repository.pageQueries.single()
            assertEquals(0, request.offset)
            assertNull(state().deviceList.error)
        }

    private fun loadConfigured() {
        viewModel.retry()
        settle()
    }

    private suspend fun loadInitial() {
        repository.bootstrapResult = AccountResult.Success(testSnapshot(devices = devices(20)))
        repository.pageResult =
            AccountResult.Success(Page(items = devices(20), total = 57, limit = 20, offset = 0))
        viewModel.retry()
        settle()
    }

    private fun devices(count: Int): List<AccountDevice> =
        (1..count).map { index -> testDevice(id = "device-$index", name = "Device $index") }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun state(): AccountUiState = viewModel.container.stateFlow.value
}
