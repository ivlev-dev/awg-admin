package space.ivlev.umbravpn.admin

import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPage
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsNumberField
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminTopDevice
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficTotals
import space.ivlev.umbravpn.ui.state.AdminListFooter
import space.ivlev.umbravpn.viewmodel.AdminAuditViewModel
import space.ivlev.umbravpn.viewmodel.AdminHubViewModel
import space.ivlev.umbravpn.viewmodel.AdminSettingsViewModel
import space.ivlev.umbravpn.viewmodel.AdminStatsViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AdminAnalyticsViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val repository = FakeAdminRepository()
    private val auth = FakeAdminAuthRepository()
    private val fixedNow = Instant.parse("2026-11-20T12:00:00Z")

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
    fun nonAdminAnalyticsViewModelsAreBlocked() =
        runTest(dispatcher) {
            auth.setSession(adminSession(role = UserRole.User))
            val audit = auditViewModel()
            val stats = statsViewModel()
            val settings = settingsViewModel()
            settle()

            assertTrue(audit.container.stateFlow.value.accessDenied)
            assertTrue(stats.container.stateFlow.value.accessDenied)
            assertTrue(settings.container.stateFlow.value.accessDenied)
            assertTrue(repository.auditQueries.isEmpty())
            assertTrue(repository.trafficQueries.isEmpty())
            assertEquals(0, repository.settingsCalls)
        }

    @Test
    fun auditInitialPageUsesLimitAndNoCursor() =
        runTest(dispatcher) {
            repository.auditResult =
                AccountResult.Success(
                    AdminAuditPage(
                        items = listOf(adminAuditEntry(id = "a1"), adminAuditEntry(id = "a2")),
                        nextCursor = "cursor-2",
                    ),
                )

            val viewModel = auditViewModel()
            settle()

            val state = viewModel.container.stateFlow.value.list
            assertEquals(2, state.items.size)
            assertEquals("cursor-2", state.nextCursor)
            assertEquals(AdminListFooter.LoadMore, state.footer)
            val query = repository.auditQueries.single()
            assertEquals(AdminAuditQuery.DEFAULT_LIMIT, query.limit)
            assertNull(query.before)
            assertNull(query.from)
            assertNull(query.to)
        }

    @Test
    fun auditLoadMoreUsesCursorAndAppendsUniqueRows() =
        runTest(dispatcher) {
            repository.auditResult =
                AccountResult.Success(
                    AdminAuditPage(
                        items = listOf(adminAuditEntry(id = "a1"), adminAuditEntry(id = "a2")),
                        nextCursor = "cursor-2",
                    ),
                )
            val viewModel = auditViewModel()
            settle()

            repository.auditHandler = { query ->
                if (query.before == null) {
                    AccountResult.Success(AdminAuditPage(emptyList(), null))
                } else {
                    AccountResult.Success(
                        AdminAuditPage(
                            items = listOf(adminAuditEntry(id = "a2"), adminAuditEntry(id = "a3")),
                            nextCursor = null,
                        ),
                    )
                }
            }
            viewModel.loadMore()
            settle()

            val state = viewModel.container.stateFlow.value.list
            assertEquals(listOf("a1", "a2", "a3"), state.items.map { it.id })
            assertEquals("cursor-2", repository.auditQueries.last().before)
            assertEquals(AdminListFooter.End, state.footer)
        }

    @Test
    fun auditFiltersAreDebouncedIntoOneRequest() =
        runTest(dispatcher) {
            val viewModel = auditViewModel()
            settle()
            repository.auditQueries.clear()

            viewModel.setActor("adm")
            dispatcher.scheduler.advanceTimeBy(100)
            viewModel.setAction("PATCH")
            viewModel.setEntity("users")
            settle()

            val query = repository.auditQueries.single()
            assertEquals("adm", query.actor)
            assertEquals("PATCH", query.action)
            assertEquals("users", query.entity)
            assertNull(query.before)
        }

    @Test
    fun auditPeriodChangeSendsWindowAndResetsCursor() =
        runTest(dispatcher) {
            repository.auditResult =
                AccountResult.Success(
                    AdminAuditPage(items = listOf(adminAuditEntry()), nextCursor = "cursor-2"),
                )
            val viewModel = auditViewModel()
            settle()
            repository.auditQueries.clear()

            viewModel.setPeriod(AdminAuditPeriod.Day24)
            settle()

            val query = repository.auditQueries.single()
            assertEquals(fixedNow, query.to)
            assertEquals(fixedNow.minusSeconds(86_400), query.from)
            assertEquals(AdminAuditPeriod.Day24, viewModel.container.stateFlow.value.list.period)
        }

    @Test
    fun auditSelectAndDismissDetail() =
        runTest(dispatcher) {
            val entry = adminAuditEntry(id = "a1")
            repository.auditResult = AccountResult.Success(AdminAuditPage(listOf(entry), null))
            val viewModel = auditViewModel()
            settle()

            viewModel.select(entry)
            settle()
            assertEquals(entry, viewModel.container.stateFlow.value.detail)

            viewModel.dismissDetail()
            settle()
            assertNull(viewModel.container.stateFlow.value.detail)
        }

    @Test
    fun auditFailureSetsErrorAndRetryRecovers() =
        runTest(dispatcher) {
            repository.auditResult = AccountResult.Failure(AccountError.Network)
            val viewModel = auditViewModel()
            settle()

            val failed = viewModel.container.stateFlow.value.list
            assertEquals(AdminMessage.Network, failed.error)
            assertTrue(failed.isLoaded)

            repository.auditResult =
                AccountResult.Success(AdminAuditPage(listOf(adminAuditEntry()), null))
            viewModel.retry()
            settle()

            val recovered = viewModel.container.stateFlow.value.list
            assertNull(recovered.error)
            assertEquals(1, recovered.items.size)
        }

    @Test
    fun statsLoadsOverviewTrafficAndQuotas() =
        runTest(dispatcher) {
            repository.overviewResult =
                AccountResult.Success(
                    AdminOverview(
                        users = 12,
                        devices = 34,
                        nodesOnline = 2,
                        nodesTotal = 3,
                        interfaces = 5,
                        today = AdminTrafficTotals(rx = 100, tx = 50),
                        topDevices =
                            listOf(
                                AdminTopDevice("dev-1", "Phone", "u1", rx = 60, tx = 40),
                                AdminTopDevice("dev-2", "Laptop", "u2", rx = 10, tx = 5),
                            ),
                    ),
                )
            repository.trafficResult =
                AccountResult.Success(
                    listOf(
                        AdminTrafficPoint(fixedNow.minusSeconds(60), rx = 100, tx = 50),
                        AdminTrafficPoint(fixedNow, rx = 300, tx = 150),
                    ),
                )
            repository.quotaUsersResult =
                AccountResult.Success(
                    listOf(
                        adminQuotaUser(userId = "u1", usedBytes = 500, quotaBytes = 1_000),
                        adminQuotaUser(
                            userId = "u2",
                            email = "bob@example.com",
                            usedBytes = 2_000,
                            quotaBytes = 1_000,
                            exceeded = true,
                            percent = 200.0,
                        ),
                    ),
                )

            val viewModel = statsViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(12, state.overview?.users)
            assertEquals(600L, state.sumRx + state.sumTx)
            assertEquals(450L, state.peak)
            assertEquals("u2", state.topUsers.first().userId)
            assertEquals("dev-1", state.topDevices.first().deviceId)
            assertEquals(2_500L, state.quotaUsedBytes)
            assertEquals(2_000L, state.quotaTotalBytes)
            assertEquals(1, state.quotaExceededCount)
            assertEquals(AdminStatsPeriod.Day24, repository.trafficQueries.single().period)
            assertTrue(state.hasTraffic)
        }

    @Test
    fun statsPeriodSwitchReloadsOnlyTraffic() =
        runTest(dispatcher) {
            val viewModel = statsViewModel()
            settle()
            repository.trafficQueries.clear()
            val overviewCalls = repository.overviewCalls

            viewModel.setPeriod(AdminStatsPeriod.Week7)
            settle()

            val query = repository.trafficQueries.single()
            assertEquals(AdminStatsPeriod.Week7, query.period)
            assertEquals(fixedNow.minusSeconds(7 * 86_400L), query.from)
            assertEquals(AdminStatsPeriod.Week7, viewModel.container.stateFlow.value.period)
            assertEquals(overviewCalls, repository.overviewCalls)
        }

    @Test
    fun statsTrafficFailureKeepsOverviewAndShowsSectionError() =
        runTest(dispatcher) {
            repository.overviewResult = AccountResult.Success(AdminOverview(users = 7))
            repository.trafficResult =
                AccountResult.Failure(AccountError.Api(500, "server", "boom"))

            val viewModel = statsViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertNotNull(state.overview)
            assertEquals(AdminMessage.Server, state.seriesError)
            assertNull(state.error)
            assertTrue(state.series.isEmpty())
        }

    @Test
    fun statsOverviewFailureSkipsTrafficAndQuotas() =
        runTest(dispatcher) {
            repository.overviewResult = AccountResult.Failure(AccountError.Network)

            val viewModel = statsViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertNull(state.overview)
            assertEquals(AdminMessage.Network, state.error)
            assertTrue(repository.trafficQueries.isEmpty())
            assertEquals(0, repository.settingsCalls)
        }

    @Test
    fun statsEmptyQuotasAreHandled() =
        runTest(dispatcher) {
            repository.quotaUsersResult = AccountResult.Success(emptyList())

            val viewModel = statsViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertTrue(state.topUsers.isEmpty())
            assertNull(state.quotaTotalBytes)
            assertEquals(0L, state.quotaUsedBytes)
            assertEquals(0, state.quotaExceededCount)
        }

    @Test
    fun settingsLoadPopulatesDraftWithoutDirtyState() =
        runTest(dispatcher) {
            repository.settingsResult =
                AccountResult.Success(
                    adminPanelSettings(
                        profile = "tls",
                        shareDefaultTtlSecs = 600,
                        statsRetentionDays = 30,
                    ),
                )

            val viewModel = settingsViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertFalse(state.isLoading)
            assertEquals("tls", state.draft.profile.apiValue)
            assertEquals("600", state.draft.shareTtl)
            assertEquals("30", state.draft.retentionDays)
            assertFalse(state.isDirty)
            assertFalse(state.canSave)
            assertEquals(1, repository.settingsCalls)
        }

    @Test
    fun settingsEditMarksDirtyAndDiscardRestoresValues() =
        runTest(dispatcher) {
            val viewModel = settingsViewModel()
            settle()

            viewModel.onNumberChange(AdminSettingsNumberField.Mtu, "1300")
            settle()

            val edited = viewModel.container.stateFlow.value
            assertTrue(edited.isDirty)
            assertEquals("1300", edited.draft.mtu)

            viewModel.discard()
            settle()

            val restored = viewModel.container.stateFlow.value
            assertFalse(restored.isDirty)
            assertEquals("1420", restored.draft.mtu)
        }

    @Test
    fun settingsInvalidRangeBlocksSave() =
        runTest(dispatcher) {
            val viewModel = settingsViewModel()
            settle()

            viewModel.onNumberChange(AdminSettingsNumberField.JcMin, "20")
            settle()
            viewModel.save()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.RangeInvalid, state.jcError)
            assertTrue(state.isDirty)
            assertTrue(repository.settingsUpdates.isEmpty())
        }

    @Test
    fun settingsInvalidPaddingBlocksSave() =
        runTest(dispatcher) {
            val viewModel = settingsViewModel()
            settle()

            viewModel.onNumberChange(AdminSettingsNumberField.SMin, "4")
            settle()
            viewModel.save()
            settle()

            assertEquals(
                AdminMessage.SFloor,
                viewModel.container.stateFlow.value.sError,
            )
            assertTrue(repository.settingsUpdates.isEmpty())
        }

    @Test
    fun settingsSaveSendsPayloadAndClearsDirty() =
        runTest(dispatcher) {
            repository.updateSettingsResult =
                AccountResult.Success(adminPanelSettings(statsRetentionDays = 14))
            val viewModel = settingsViewModel()
            settle()

            viewModel.onNumberChange(AdminSettingsNumberField.Mtu, "1300")
            viewModel.onNumberChange(AdminSettingsNumberField.RetentionDays, "14")
            settle()
            viewModel.save()
            settle()

            val payload = repository.settingsUpdates.single()
            assertEquals(1300, payload.obfuscation.mtu)
            assertEquals(14, payload.statsRetentionDays)

            val state = viewModel.container.stateFlow.value
            assertFalse(state.isDirty)
            assertTrue(state.isSaved)
            assertFalse(state.isSaving)
            assertEquals("14", state.draft.retentionDays)
        }

    @Test
    fun settingsSaveWithoutChangesIsIgnored() =
        runTest(dispatcher) {
            val viewModel = settingsViewModel()
            settle()

            viewModel.save()
            settle()

            assertTrue(repository.settingsUpdates.isEmpty())
        }

    @Test
    fun settingsSaveAlreadySavedDoesNotResubmit() =
        runTest(dispatcher) {
            val viewModel = settingsViewModel()
            settle()
            viewModel.onNumberChange(AdminSettingsNumberField.Mtu, "1300")
            settle()
            viewModel.save()
            settle()
            viewModel.save()
            settle()

            assertEquals(1, repository.settingsUpdates.size)
        }

    @Test
    fun settingsSaveErrorKeepsDraftDirty() =
        runTest(dispatcher) {
            repository.updateSettingsResult =
                AccountResult.Failure(AccountError.Api(400, "bad_request", "invalid keepalive"))
            val viewModel = settingsViewModel()
            settle()
            viewModel.onNumberChange(AdminSettingsNumberField.KeepaliveMin, "10")
            settle()

            viewModel.save()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.Unknown, state.error)
            assertTrue(state.isDirty)
            assertFalse(state.isSaving)
            assertFalse(state.isSaved)
        }

    @Test
    fun hubLoadsSettingsAndRecentAuditCounters() =
        runTest(dispatcher) {
            repository.settingsResult =
                AccountResult.Success(adminPanelSettings(statsRetentionDays = 45))
            repository.auditResult =
                AccountResult.Success(
                    AdminAuditPage(
                        items = listOf(adminAuditEntry(id = "a1"), adminAuditEntry(id = "a2")),
                        nextCursor = "cursor-2",
                    ),
                )

            val viewModel = hubViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(45, state.retentionDays)
            assertEquals(2, state.recentAudit)
            assertTrue(state.hasMoreAudit)
            assertEquals(1, repository.dashboardCalls)
            assertEquals(20, repository.auditQueries.single().limit)
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun TestScope.auditViewModel(): AdminAuditViewModel =
        AdminAuditViewModel(repository, auth) { fixedNow }.also { activate(it.container.stateFlow) }

    private fun TestScope.statsViewModel(): AdminStatsViewModel =
        AdminStatsViewModel(repository, auth) { fixedNow }.also { activate(it.container.stateFlow) }

    private fun TestScope.settingsViewModel(): AdminSettingsViewModel =
        AdminSettingsViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.hubViewModel(): AdminHubViewModel =
        AdminHubViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.activate(flow: StateFlow<*>) {
        backgroundScope.launch(dispatcher) { flow.collect {} }
    }
}
