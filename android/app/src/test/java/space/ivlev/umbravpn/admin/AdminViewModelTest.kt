package space.ivlev.umbravpn.admin

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
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab
import space.ivlev.umbravpn.ui.state.AdminListFooter
import space.ivlev.umbravpn.ui.state.AdminTariffDialog
import space.ivlev.umbravpn.viewmodel.AdminHubViewModel
import space.ivlev.umbravpn.viewmodel.AdminTariffsViewModel
import space.ivlev.umbravpn.viewmodel.AdminUsersViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AdminViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val repository = FakeAdminRepository()
    private val auth = FakeAdminAuthRepository()

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
    fun nonAdminUsersViewModelDoesNotCallRepository() =
        runTest(dispatcher) {
            auth.setSession(adminSession(role = UserRole.User))
            val viewModel = usersViewModel()
            settle()

            assertTrue(viewModel.container.stateFlow.value.accessDenied)
            assertTrue(repository.queries.isEmpty())
        }

    @Test
    fun nonAdminHubAndTariffsViewModelsAreBlocked() =
        runTest(dispatcher) {
            auth.setSession(adminSession(role = UserRole.User))
            val hub = hubViewModel()
            val tariffs = tariffsViewModel()
            settle()

            assertTrue(hub.container.stateFlow.value.accessDenied)
            assertTrue(tariffs.container.stateFlow.value.accessDenied)
            assertEquals(0, repository.dashboardCalls)
        }

    @Test
    fun initialUsersPageUsesLimitTwelveAndPaginationFooter() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(
                    Page(items = users(20), total = 57, limit = 20, offset = 0),
                )

            val viewModel = usersViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(20, state.list.items.size)
            assertEquals(57, state.list.total)
            assertEquals(AdminListFooter.LoadMore, state.list.footer)
            val query = repository.queries.single()
            assertEquals(20, query.limit)
            assertEquals(0, query.offset)
            assertEquals(AdminUserTab.Active, query.tab)
            assertEquals("", query.query)
        }

    @Test
    fun searchIsDebouncedIntoSingleRequest() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(2), 2, 20, 0))
            val viewModel = usersViewModel()
            settle()
            repository.queries.clear()

            viewModel.setQuery("a")
            dispatcher.scheduler.advanceTimeBy(100)
            viewModel.setQuery("alice")
            settle()

            assertEquals(1, repository.queries.size)
            assertEquals("alice", repository.queries.single().query)
            assertEquals(0, repository.queries.single().offset)
        }

    @Test
    fun loadMoreAppendsNextPageWithoutDuplicates() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(20), 25, 20, 0))
            val viewModel = usersViewModel()
            settle()

            repository.pageResult =
                AccountResult.Success(
                    Page(
                        items = listOf(adminUser(id = "user-20")) + users(5, start = 21),
                        total = 25,
                        limit = 20,
                        offset = 20,
                    ),
                )
            viewModel.loadMore()
            settle()

            val list = viewModel.container.stateFlow.value.list
            assertEquals(25, list.items.size)
            assertEquals(25, list.items.map { it.id }.distinct().size)
            assertEquals(20, repository.queries.last().offset)
            assertEquals(AdminListFooter.End, list.footer)
        }

    @Test
    fun tabSwitchReloadsWithPendingFilter() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(
                    Page(listOf(adminUser(id = "pending-1")), 1, 20, 0),
                )
            val viewModel = usersViewModel()
            settle()

            viewModel.setTab(AdminUserTab.Pending)
            settle()

            assertEquals(AdminUserTab.Pending, repository.queries.last().tab)
            assertEquals(0, repository.queries.last().offset)
            assertEquals("pending-1", viewModel.container.stateFlow.value.list.items.single().id)
        }

    @Test
    fun approveUsesSelectedTariffAndRemovesPendingUser() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(Page(listOf(adminUser(id = "pending-1")), 1, 20, 0))
            val viewModel = usersViewModel()
            settle()
            viewModel.setTab(AdminUserTab.Pending)
            settle()

            viewModel.showApprove(adminUser(id = "pending-1"))
            settle()
            assertEquals(1, viewModel.container.stateFlow.value.tariffs.size)

            viewModel.approve("tariff-1")
            settle()

            val call = repository.approvals.single()
            assertEquals("pending-1", call.id)
            assertEquals("tariff-1", call.tariffId)
            assertTrue(viewModel.container.stateFlow.value.list.items.isEmpty())
            assertNull(viewModel.container.stateFlow.value.dialog)
        }

    @Test
    fun approveWithoutTariffIsRejectedBeforeRequest() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(1), 1, 20, 0))
            val viewModel = usersViewModel()
            settle()
            viewModel.showApprove(adminUser(id = "user-1"))
            settle()

            viewModel.approve("")
            settle()

            assertTrue(repository.approvals.isEmpty())
            assertEquals(
                AdminMessage.TariffRequired,
                viewModel.container.stateFlow.value.dialogError,
            )
        }

    @Test
    fun approveConflictKeepsDialogAndShowsMappedError() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(1), 1, 20, 0))
            repository.approveResult =
                AccountResult.Failure(AccountError.Api(409, "conflict", "already approved"))
            val viewModel = usersViewModel()
            settle()
            viewModel.showApprove(adminUser(id = "user-1"))
            settle()

            viewModel.approve("tariff-1")
            settle()

            val state = viewModel.container.stateFlow.value
            assertNotNull(state.dialog)
            assertEquals(AdminMessage.Conflict("already approved"), state.dialogError)
            assertEquals(1, state.list.items.size)
        }

    @Test
    fun deleteUserRemovesRowAndCallsApi() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(2), 2, 20, 0))
            val viewModel = usersViewModel()
            settle()

            viewModel.showDelete(adminUser(id = "user-1"))
            settle()
            viewModel.delete()
            settle()

            assertEquals(listOf("user-1"), repository.deletedUsers)
            val list = viewModel.container.stateFlow.value.list
            assertEquals(listOf("user-2"), list.items.map { it.id })
            assertEquals(1, list.total)
        }

    @Test
    fun blockToggleSendsFullUserDraft() =
        runTest(dispatcher) {
            val user = adminUser(id = "user-1", disabled = false)
            repository.pageResult = AccountResult.Success(Page(listOf(user), 1, 20, 0))
            repository.updateUserResult = AccountResult.Success(user.copy(disabled = true))
            val viewModel = usersViewModel()
            settle()

            viewModel.showSetDisabled(user)
            settle()
            viewModel.setDisabled()
            settle()

            val (id, draft) = repository.updatedUsers.single()
            assertEquals("user-1", id)
            assertTrue(draft.disabled)
            assertEquals(user.email, draft.email)
            assertEquals(user.role, draft.role)
            assertTrue(viewModel.container.stateFlow.value.list.items.single().disabled)
        }

    @Test
    fun resetPasswordValidatesLengthThenCallsApi() =
        runTest(dispatcher) {
            repository.pageResult = AccountResult.Success(Page(users(1), 1, 20, 0))
            val viewModel = usersViewModel()
            settle()
            viewModel.showResetPassword(adminUser(id = "user-1"))
            settle()

            viewModel.resetPassword("short")
            settle()
            assertTrue(repository.resetPasswords.isEmpty())
            assertEquals(
                AdminMessage.PasswordTooShort,
                viewModel.container.stateFlow.value.dialogError,
            )

            viewModel.resetPassword("password123")
            settle()
            assertEquals("user-1" to "password123", repository.resetPasswords.single())
            assertNull(viewModel.container.stateFlow.value.dialog)
        }

    @Test
    fun rejectRemovesPendingUser() =
        runTest(dispatcher) {
            repository.pageResult =
                AccountResult.Success(Page(listOf(adminUser(id = "pending-1")), 1, 20, 0))
            val viewModel = usersViewModel()
            settle()
            viewModel.setTab(AdminUserTab.Pending)
            settle()
            viewModel.showReject(adminUser(id = "pending-1"))
            settle()

            viewModel.reject()
            settle()

            assertEquals(listOf("pending-1"), repository.rejected)
            assertTrue(viewModel.container.stateFlow.value.list.items.isEmpty())
        }

    @Test
    fun tariffsLoadAndDelete() =
        runTest(dispatcher) {
            val viewModel = tariffsViewModel()
            settle()
            assertEquals(1, viewModel.container.stateFlow.value.items.size)

            viewModel.showDelete("tariff-1", "Standard")
            settle()
            assertEquals(
                AdminTariffDialog.Delete("tariff-1", "Standard"),
                viewModel.container.stateFlow.value.dialog,
            )

            viewModel.delete()
            settle()

            assertEquals(listOf("tariff-1"), repository.deletedTariffs)
            assertTrue(viewModel.container.stateFlow.value.items.isEmpty())
            assertNull(viewModel.container.stateFlow.value.dialog)
        }

    @Test
    fun tariffsFailureMapsToMessage() =
        runTest(dispatcher) {
            repository.listTariffsResult = AccountResult.Failure(AccountError.Network)
            val viewModel = tariffsViewModel()
            settle()

            assertFalse(viewModel.container.stateFlow.value.isLoading)
            assertEquals(AdminMessage.Network, viewModel.container.stateFlow.value.error)
        }

    @Test
    fun hubLoadsDashboardCounters() =
        runTest(dispatcher) {
            val viewModel = hubViewModel()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(12, state.overview?.users)
            assertEquals(4, state.pendingUsers)
            assertEquals(2, state.overview?.nodesOnline)
            assertEquals(1, repository.dashboardCalls)
        }

    private fun users(
        count: Int,
        start: Int = 1,
    ): List<space.ivlev.umbravpn.domain.model.admin.AdminUser> =
        (start until start + count).map { index ->
            adminUser(id = "user-$index", email = "user$index@example.com")
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun TestScope.usersViewModel(): AdminUsersViewModel =
        AdminUsersViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.hubViewModel(): AdminHubViewModel =
        AdminHubViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.tariffsViewModel(): AdminTariffsViewModel =
        AdminTariffsViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.activate(flow: StateFlow<*>) {
        backgroundScope.launch(dispatcher) { flow.collect {} }
    }
}
