package space.ivlev.umbravpn.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
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
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.ui.state.AccountDialog
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.viewmodel.AccountViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelProfileTest {
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
    fun editDialogPrefillsCurrentFullName() =
        runTest(dispatcher) {
            repository.bootstrapResult =
                AccountResult.Success(testSnapshot().copy(user = testUser(fullName = "Alice")))

            viewModel.retry()
            settle()
            viewModel.showEditFullName()
            settle()

            assertEquals(AccountDialog.EditFullName("Alice"), state().dialog)
        }

    @Test
    fun editDialogStartsWithEmptyNameWhenNotSet() =
        runTest(dispatcher) {
            repository.bootstrapResult =
                AccountResult.Success(testSnapshot().copy(user = testUser(fullName = null)))

            viewModel.retry()
            settle()
            viewModel.showEditFullName()
            settle()

            assertEquals(AccountDialog.EditFullName(""), state().dialog)
        }

    @Test
    fun savingFullNameUpdatesSnapshotAndEmitsNotice() =
        runTest(dispatcher) {
            val updated = testUser(fullName = "Alice Ivanova")
            repository.updateFullNameResult = AccountResult.Success(updated)
            val effects = mutableListOf<AccountSideEffect>()
            backgroundScope.launch(dispatcher) {
                viewModel.container.sideEffectFlow.collect { effects += it }
            }

            viewModel.retry()
            settle()
            viewModel.showEditFullName()
            settle()

            viewModel.updateFullName("  Alice Ivanova  ")
            settle()

            assertEquals(listOf("Alice Ivanova"), repository.updatedFullNames)
            assertEquals("Alice Ivanova", state().snapshot?.user?.fullName)
            assertNull(state().dialog)
            assertNull(state().dialogError)
            assertTrue(effects.contains(AccountSideEffect.Notice(AccountMessage.FullNameUpdated)))
        }

    @Test
    fun invalidFullNameKeepsDialogOpenWithError() =
        runTest(dispatcher) {
            viewModel.retry()
            settle()
            viewModel.showEditFullName()
            settle()

            viewModel.updateFullName("   ")
            settle()

            assertTrue(repository.updatedFullNames.isEmpty())
            assertTrue(state().dialog is AccountDialog.EditFullName)
            assertEquals(AccountMessage.EmptyFullName, state().dialogError)
        }

    @Test
    fun apiFailureKeepsDialogOpenWithMappedError() =
        runTest(dispatcher) {
            repository.updateFullNameResult =
                AccountResult.Failure(AccountError.Api(400, "bad_request", "invalid"))
            viewModel.retry()
            settle()
            viewModel.showEditFullName()
            settle()

            viewModel.updateFullName("Alice")
            settle()

            assertTrue(state().dialog is AccountDialog.EditFullName)
            assertEquals(AccountMessage.Unknown, state().dialogError)
            assertTrue(state().isActionInProgress.not())
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun state() = viewModel.container.stateFlow.value
}
