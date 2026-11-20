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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.orbitmvi.orbit.Orbit
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminValidation
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.ui.state.AdminTariffFormUiState
import space.ivlev.umbravpn.ui.state.AdminUserFormUiState
import space.ivlev.umbravpn.viewmodel.AdminTariffFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminUserFormViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AdminFormViewModelTest {
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
    fun nonAdminFormViewModelsDoNotCallRepository() =
        runTest(dispatcher) {
            auth.setSession(adminSession(role = UserRole.User))
            val userForm = userFormViewModel(null)
            val tariffForm = tariffFormViewModel(null)
            settle()

            assertTrue(userForm.container.stateFlow.value.accessDenied)
            assertTrue(tariffForm.container.stateFlow.value.accessDenied)
            assertTrue(repository.createdUsers.isEmpty())
            assertTrue(repository.createdTariffs.isEmpty())
        }

    @Test
    fun editUserFormLoadsUserAndCatalogs() =
        runTest(dispatcher) {
            repository.userResult =
                AccountResult.Success(
                    adminUser(
                        id = "user-1",
                        email = "alice@example.com",
                        fullName = "Alice Ivanova",
                        role = UserRole.Admin,
                        tariffId = "tariff-1",
                        nodeId = "node-1",
                        groupId = "group-1",
                        disabled = true,
                    ),
                )

            val viewModel = userFormViewModel("user-1")
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals("alice@example.com", state.email)
            assertEquals("Alice Ivanova", state.fullName)
            assertEquals(UserRole.Admin, state.role)
            assertEquals("tariff-1", state.tariffId)
            assertEquals("node-1", state.nodeId)
            assertEquals("group-1", state.groupId)
            assertTrue(state.disabled)
            assertEquals(1, state.catalogs.tariffs.size)
            assertEquals("Frankfurt", state.catalogs.nodes.single().label)
            assertEquals("Default", state.catalogs.groups.single().label)
            assertFalse(state.isLoading)
        }

    @Test
    fun createUserValidatesRequiredFieldsBeforeRequest() =
        runTest(dispatcher) {
            val viewModel = userFormViewModel(null)
            settle()

            viewModel.save()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.EmailRequired, state.emailError)
            assertEquals(AdminMessage.PasswordRequired, state.passwordError)
            assertTrue(repository.createdUsers.isEmpty())
        }

    @Test
    fun createUserSendsDraftWithPasswordAndRole() =
        runTest(dispatcher) {
            val viewModel = userFormViewModel(null)
            settle()

            viewModel.onEmailChange(" bob@example.com ")
            viewModel.onFullNameChange("Bob Stone")
            viewModel.onPasswordChange("password123")
            viewModel.onRoleChange(UserRole.Admin)
            viewModel.onTariffChange("tariff-1")
            viewModel.save()
            settle()

            val draft = repository.createdUsers.single()
            assertEquals("bob@example.com", draft.email)
            assertEquals("Bob Stone", draft.fullName)
            assertEquals("password123", draft.password)
            assertEquals(UserRole.Admin, draft.role)
            assertEquals("tariff-1", draft.tariffId)
            assertFalse(viewModel.container.stateFlow.value.isSaving)
        }

    @Test
    fun createUserShowsInvalidEmailAndShortPassword() =
        runTest(dispatcher) {
            val viewModel = userFormViewModel(null)
            settle()

            viewModel.onEmailChange("not-an-email")
            viewModel.onPasswordChange("short")
            viewModel.save()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.EmailInvalid, state.emailError)
            assertEquals(AdminMessage.PasswordTooShort, state.passwordError)
            assertTrue(repository.createdUsers.isEmpty())
        }

    @Test
    fun updateUserUsesIdAndOmitsPassword() =
        runTest(dispatcher) {
            repository.userResult = AccountResult.Success(adminUser(id = "user-1"))
            val viewModel = userFormViewModel("user-1")
            settle()

            viewModel.onFullNameChange("Alice Updated")
            viewModel.onDisabledChange(true)
            viewModel.save()
            settle()

            val (id, draft) = repository.updatedUsers.single()
            assertEquals("user-1", id)
            assertEquals("Alice Updated", draft.fullName)
            assertNull(draft.password)
            assertTrue(draft.disabled)
        }

    @Test
    fun createTariffConvertsGigabytesToBytes() =
        runTest(dispatcher) {
            val viewModel = tariffFormViewModel(null)
            settle()

            viewModel.onNameChange(" Basic ")
            viewModel.onDescriptionChange(" Starter ")
            viewModel.onMaxDevicesChange("3")
            viewModel.onDownChange("10000")
            viewModel.onUpChange("5000")
            viewModel.onQuotaChange("1.5")
            viewModel.save()
            settle()

            val draft = repository.createdTariffs.single()
            assertEquals("Basic", draft.name)
            assertEquals("Starter", draft.description)
            assertEquals(3, draft.maxDevices)
            assertEquals(10_000, draft.deviceDownKbps)
            assertEquals(5_000, draft.deviceUpKbps)
            assertEquals((1.5 * AdminValidation.GIB_BYTES).toLong(), draft.trafficQuotaBytes)
            assertTrue(repository.createdTariffs.isNotEmpty())
        }

    @Test
    fun editTariffLoadsValuesAndUpdates() =
        runTest(dispatcher) {
            repository.listTariffsResult =
                AccountResult.Success(
                    listOf(
                        adminTariff(
                            id = "tariff-1",
                            name = "Standard",
                            trafficQuotaBytes = 10L * 1024 * 1024 * 1024,
                            interfaceId = "iface-1",
                        ),
                    ),
                )
            val viewModel = tariffFormViewModel("tariff-1")
            settle()

            val loaded = viewModel.container.stateFlow.value
            assertEquals("Standard", loaded.name)
            assertEquals("10", loaded.quotaGb)
            assertEquals("iface-1", loaded.interfaceId)
            assertEquals("awg0", loaded.interfaces.single().label)

            viewModel.onNameChange("Renamed")
            viewModel.save()
            settle()

            val (id, draft) = repository.updatedTariffs.single()
            assertEquals("tariff-1", id)
            assertEquals("Renamed", draft.name)
            assertEquals(10L * 1024 * 1024 * 1024, draft.trafficQuotaBytes)
        }

    @Test
    fun invalidTariffNumbersAreRejectedBeforeRequest() =
        runTest(dispatcher) {
            val viewModel = tariffFormViewModel(null)
            settle()

            viewModel.onNameChange("")
            viewModel.onMaxDevicesChange("0")
            viewModel.onDownChange("abc")
            viewModel.onQuotaChange("-2")
            viewModel.save()
            settle()

            val state: AdminTariffFormUiState = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.NameRequired, state.nameError)
            assertEquals(AdminMessage.MaxDevicesInvalid, state.maxDevicesError)
            assertEquals(AdminMessage.SpeedInvalid, state.speedError)
            assertEquals(AdminMessage.QuotaInvalid, state.quotaError)
            assertTrue(repository.createdTariffs.isEmpty())
        }

    @Test
    fun tariffFormShowsNotFoundForMissingTariff() =
        runTest(dispatcher) {
            repository.listTariffsResult = AccountResult.Success(emptyList())
            val viewModel = tariffFormViewModel("missing")
            settle()

            val state: AdminTariffFormUiState = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.NotFound, state.error)
            assertFalse(state.isLoading)
        }

    @Test
    fun userFormRejectsTooLongFullName() =
        runTest(dispatcher) {
            val viewModel = userFormViewModel(null)
            settle()
            viewModel.onEmailChange("bob@example.com")
            viewModel.onPasswordChange("password123")
            viewModel.onFullNameChange("x".repeat(AdminValidation.FULL_NAME_MAX_LENGTH + 1))

            viewModel.save()
            settle()

            val state: AdminUserFormUiState = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.FullNameTooLong, state.fullNameError)
            assertTrue(repository.createdUsers.isEmpty())
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun TestScope.userFormViewModel(id: String?): AdminUserFormViewModel =
        AdminUserFormViewModel(repository, auth, id).also { activate(it.container.stateFlow) }

    private fun TestScope.tariffFormViewModel(id: String?): AdminTariffFormViewModel =
        AdminTariffFormViewModel(repository, auth, id).also { activate(it.container.stateFlow) }

    private fun TestScope.activate(flow: StateFlow<*>) {
        backgroundScope.launch(dispatcher) { flow.collect {} }
    }
}
