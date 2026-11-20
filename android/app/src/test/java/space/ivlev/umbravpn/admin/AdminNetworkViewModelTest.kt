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
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.ui.state.AdminNodeDialog
import space.ivlev.umbravpn.ui.state.AdminTokenReason
import space.ivlev.umbravpn.viewmodel.AdminGroupFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminGroupsViewModel
import space.ivlev.umbravpn.viewmodel.AdminInterfaceFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminInterfacesViewModel
import space.ivlev.umbravpn.viewmodel.AdminNodeFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminNodesViewModel
import space.ivlev.umbravpn.viewmodel.AdminPoolFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminPoolsViewModel

@OptIn(ExperimentalCoroutinesApi::class)
class AdminNetworkViewModelTest {
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
    fun nonAdminNetworkViewModelsAreBlocked() =
        runTest(dispatcher) {
            auth.setSession(adminSession(role = UserRole.User))
            val nodes = nodesViewModel()
            val interfaces = interfacesViewModel()
            val groups = groupsViewModel()
            val pools = poolsViewModel("group-1")
            val nodeForm = nodeFormViewModel()
            val interfaceForm = interfaceFormViewModel(null)
            val groupForm = groupFormViewModel(null)
            val poolForm = poolFormViewModel("group-1", null)
            settle()

            assertTrue(nodes.container.stateFlow.value.accessDenied)
            assertTrue(interfaces.container.stateFlow.value.accessDenied)
            assertTrue(groups.container.stateFlow.value.accessDenied)
            assertTrue(pools.container.stateFlow.value.accessDenied)
            assertTrue(nodeForm.container.stateFlow.value.accessDenied)
            assertTrue(interfaceForm.container.stateFlow.value.accessDenied)
            assertTrue(groupForm.container.stateFlow.value.accessDenied)
            assertTrue(poolForm.container.stateFlow.value.accessDenied)
            assertTrue(repository.deletedNodes.isEmpty())
            assertTrue(repository.createdInterfaces.isEmpty())
        }

    @Test
    fun nodesLoadDeleteAndRotateRevealToken() =
        runTest(dispatcher) {
            repository.nodeListResult =
                space.ivlev.umbravpn.domain.model.account.AccountResult.Success(
                    listOf(adminNode(id = "node-1"), adminNode(id = "node-2", name = "Amsterdam")),
                )
            val viewModel = nodesViewModel()
            settle()
            assertEquals(2, viewModel.container.stateFlow.value.items.size)

            viewModel.showDelete("node-2", "Amsterdam")
            settle()
            assertEquals(
                AdminNodeDialog.Delete("node-2", "Amsterdam"),
                viewModel.container.stateFlow.value.dialog,
            )
            viewModel.delete()
            settle()
            assertEquals(listOf("node-2"), repository.deletedNodes)
            assertEquals(listOf("node-1"), viewModel.container.stateFlow.value.items.map { it.id })

            viewModel.showRotate("node-1", "Frankfurt")
            settle()
            viewModel.rotate()
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals(listOf("node-1"), repository.rotatedNodes)
            assertNull(state.dialog)
            assertEquals("rotated-token", state.revealedToken?.token)
            assertEquals(AdminTokenReason.Rotated, state.revealedToken?.reason)

            viewModel.dismissToken()
            settle()
            assertNull(viewModel.container.stateFlow.value.revealedToken)
        }

    @Test
    fun interfacesLoadAndFilterByNodeAndGroup() =
        runTest(dispatcher) {
            repository.interfaceListResult =
                space.ivlev.umbravpn.domain.model.account.AccountResult.Success(
                    listOf(
                        adminInterface(id = "iface-1", nodeId = "node-1", groupId = "group-1"),
                        adminInterface(
                            id = "iface-2",
                            nodeId = "node-2",
                            groupId = "group-2",
                            name = "awg1",
                        ),
                    ),
                )
            val viewModel = interfacesViewModel()
            settle()
            assertEquals(2, viewModel.container.stateFlow.value.items.size)
            assertEquals(1, viewModel.container.stateFlow.value.nodes.size)

            viewModel.setNodeFilter("node-2")
            settle()
            assertEquals(
                listOf("iface-2"),
                viewModel.container.stateFlow.value.filtered.map { it.id },
            )

            viewModel.setGroupFilter("group-1")
            settle()
            assertTrue(viewModel.container.stateFlow.value.filtered.isEmpty())
        }

    @Test
    fun interfacesDeleteAndRotateReplaceRow() =
        runTest(dispatcher) {
            repository.interfaceListResult =
                space.ivlev.umbravpn.domain.model.account.AccountResult.Success(
                    listOf(adminInterface(id = "iface-1")),
                )
            val viewModel = interfacesViewModel()
            settle()

            viewModel.showRotate(repository.interfaceListResult.requireValue().single())
            settle()
            viewModel.rotate()
            settle()
            val state = viewModel.container.stateFlow.value
            assertEquals(listOf("iface-1"), repository.rotatedInterfaces)
            assertEquals("rotated-key", state.items.single().publicKey)
            assertNotNull(state.revealedKey)

            viewModel.dismissReveal()
            settle()
            assertNull(viewModel.container.stateFlow.value.revealedKey)

            viewModel.showDelete(state.items.single())
            settle()
            viewModel.delete()
            settle()
            assertEquals(listOf("iface-1"), repository.deletedInterfaces)
            assertTrue(viewModel.container.stateFlow.value.items.isEmpty())
        }

    @Test
    fun groupsDeleteShowsCascadeCounts() =
        runTest(dispatcher) {
            repository.groupListResult =
                space.ivlev.umbravpn.domain.model.account.AccountResult.Success(
                    listOf(adminGroup(id = "group-1", interfaces = 3, devices = 9)),
                )
            val viewModel = groupsViewModel()
            settle()

            viewModel.showDelete(viewModel.container.stateFlow.value.items.single())
            settle()
            val state = viewModel.container.stateFlow.value
            assertTrue(state.dialog is space.ivlev.umbravpn.ui.state.AdminGroupDialog.Delete)
            val dialog = state.dialog as space.ivlev.umbravpn.ui.state.AdminGroupDialog.Delete
            assertEquals(3, dialog.interfaces)
            assertEquals(9, dialog.devices)

            viewModel.delete()
            settle()
            assertEquals(listOf("group-1"), repository.deletedGroups)
            assertTrue(viewModel.container.stateFlow.value.items.isEmpty())
        }

    @Test
    fun poolsLoadGroupNameAndDelete() =
        runTest(dispatcher) {
            val viewModel = poolsViewModel("group-1")
            settle()
            assertEquals("Default", viewModel.container.stateFlow.value.groupName)
            assertEquals(1, viewModel.container.stateFlow.value.items.size)

            viewModel.showDelete(viewModel.container.stateFlow.value.items.single())
            settle()
            viewModel.delete()
            settle()
            assertEquals(listOf("pool-1"), repository.deletedPools)
            assertTrue(viewModel.container.stateFlow.value.items.isEmpty())
        }

    @Test
    fun nodeFormValidatesNameAndRevealsTokenOnce() =
        runTest(dispatcher) {
            val viewModel = nodeFormViewModel()
            settle()

            viewModel.save()
            settle()
            assertEquals(AdminMessage.NameRequired, viewModel.container.stateFlow.value.nameError)
            assertTrue(repository.createdNodes.isEmpty())

            viewModel.onNameChange(" Frankfurt ")
            viewModel.save()
            settle()
            val state = viewModel.container.stateFlow.value
            assertEquals("Frankfurt", repository.createdNodes.single().name)
            assertEquals("token-1", state.revealedToken?.token)
            assertEquals(AdminTokenReason.Created, state.revealedToken?.reason)

            viewModel.dismissToken()
            settle()
            assertNull(viewModel.container.stateFlow.value.revealedToken)
            assertTrue(viewModel.container.stateFlow.value.created)
        }

    @Test
    fun interfaceFormRejectsMissingSelectionsAndBadPorts() =
        runTest(dispatcher) {
            val viewModel = interfaceFormViewModel(null)
            settle()

            viewModel.save()
            settle()
            val state = viewModel.container.stateFlow.value
            assertEquals(AdminMessage.GroupRequired, state.groupError)
            assertEquals(AdminMessage.NodeRequired, state.nodeError)
            assertEquals(AdminMessage.InterfaceNameInvalid, state.nameError)
            assertEquals(AdminMessage.HostRequired, state.hostError)
            assertTrue(repository.createdInterfaces.isEmpty())

            viewModel.onGroupChange("group-1")
            viewModel.onNodeChange("node-1")
            viewModel.onNameChange("awg0")
            viewModel.onHostChange("vpn.example.com")
            viewModel.onEndpointPortChange("70000")
            viewModel.save()
            settle()
            assertEquals(
                AdminMessage.PortInvalid,
                viewModel.container.stateFlow.value.endpointPortError,
            )
            assertTrue(repository.createdInterfaces.isEmpty())
        }

    @Test
    fun interfaceFormCreatesAndEditSendsEnabled() =
        runTest(dispatcher) {
            val create = interfaceFormViewModel(null)
            settle()
            create.onGroupChange("group-1")
            create.onNodeChange("node-1")
            create.onNameChange("awg0")
            create.onLabelChange(" Main ")
            create.onHostChange("vpn.example.com")
            create.save()
            settle()

            val draft = repository.createdInterfaces.single()
            assertEquals("group-1", draft.groupId)
            assertEquals("node-1", draft.nodeId)
            assertEquals("awg0", draft.name)
            assertEquals("Main", draft.label)
            assertEquals(51820, draft.endpointPort)

            val edit = interfaceFormViewModel("iface-1")
            settle()
            val loaded = edit.container.stateFlow.value
            assertEquals("awg0", loaded.name)
            assertTrue(loaded.enabled)

            edit.onEnabledChange(false)
            edit.onMtuChange("1380")
            edit.save()
            settle()

            val (id, update) = repository.updatedInterfaces.single()
            assertEquals("iface-1", id)
            assertFalse(update.enabled)
            assertEquals(1380, update.mtu)
        }

    @Test
    fun groupFormValidatesCidrAndCreates() =
        runTest(dispatcher) {
            val viewModel = groupFormViewModel(null)
            settle()

            viewModel.onNameChange("Default")
            viewModel.onCidrChange("10.8.0.0/33")
            viewModel.save()
            settle()
            assertEquals(AdminMessage.CidrInvalid, viewModel.container.stateFlow.value.cidrError)
            assertTrue(repository.createdGroups.isEmpty())

            viewModel.onCidrChange("10.8.0.0/24")
            viewModel.onForwardingChange(true)
            viewModel.save()
            settle()

            val draft = repository.createdGroups.single()
            assertEquals("Default", draft.name)
            assertEquals("10.8.0.0/24", draft.baseCidr)
            assertTrue(draft.forwardingDefault)
        }

    @Test
    fun groupFormEditLoadsGroup() =
        runTest(dispatcher) {
            repository.groupListResult =
                space.ivlev.umbravpn.domain.model.account.AccountResult.Success(
                    listOf(
                        adminGroup(
                            id = "group-1",
                            name = "Default",
                            interfaces = 2,
                            devices = 4,
                        ),
                    ),
                )
            val viewModel = groupFormViewModel("group-1")
            settle()

            val state = viewModel.container.stateFlow.value
            assertEquals("Default", state.name)
            assertEquals("10.8.0.0/24", state.baseCidr)
            assertTrue(state.isEditing)
        }

    @Test
    fun poolFormValidatesAndCreates() =
        runTest(dispatcher) {
            val viewModel = poolFormViewModel("group-1", null)
            settle()

            viewModel.onNameChange("Pool")
            viewModel.onCidrChange("bad-cidr")
            viewModel.onGatewayChange("10.8.0.999")
            viewModel.save()
            settle()
            assertEquals(AdminMessage.CidrInvalid, viewModel.container.stateFlow.value.cidrError)
            assertEquals(
                AdminMessage.GatewayInvalid,
                viewModel.container.stateFlow.value.gatewayError,
            )
            assertTrue(repository.createdPools.isEmpty())

            viewModel.onCidrChange("10.8.0.0/25")
            viewModel.onGatewayChange("10.8.0.1")
            viewModel.onModeChange(AdminPoolMode.RfOnly)
            viewModel.save()
            settle()

            val (groupId, draft) = repository.createdPools.single()
            assertEquals("group-1", groupId)
            assertEquals("10.8.0.0/25", draft.cidr)
            assertEquals(AdminPoolMode.RfOnly, draft.mode)
            assertEquals("10.8.0.1", draft.gateway)
        }

    @Test
    fun poolFormEditSendsModeGatewayAndEnabled() =
        runTest(dispatcher) {
            val viewModel = poolFormViewModel("group-1", "pool-1")
            settle()
            val loaded = viewModel.container.stateFlow.value
            assertTrue(loaded.enabled)
            assertEquals("10.8.0.1", loaded.gateway)

            viewModel.onEnabledChange(false)
            viewModel.onModeChange(AdminPoolMode.ExternalOnly)
            viewModel.onGatewayChange("")
            viewModel.save()
            settle()

            val (id, update) = repository.updatedPools.single()
            assertEquals("pool-1", id)
            assertFalse(update.enabled)
            assertEquals(AdminPoolMode.ExternalOnly, update.mode)
            assertNull(update.gateway)
        }

    private fun settle() {
        dispatcher.scheduler.advanceUntilIdle()
    }

    private fun TestScope.nodesViewModel(): AdminNodesViewModel =
        AdminNodesViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.interfacesViewModel(): AdminInterfacesViewModel =
        AdminInterfacesViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.groupsViewModel(): AdminGroupsViewModel =
        AdminGroupsViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.poolsViewModel(groupId: String): AdminPoolsViewModel =
        AdminPoolsViewModel(repository, auth, groupId).also { activate(it.container.stateFlow) }

    private fun TestScope.nodeFormViewModel(): AdminNodeFormViewModel =
        AdminNodeFormViewModel(repository, auth).also { activate(it.container.stateFlow) }

    private fun TestScope.interfaceFormViewModel(id: String?): AdminInterfaceFormViewModel =
        AdminInterfaceFormViewModel(repository, auth, id).also { activate(it.container.stateFlow) }

    private fun TestScope.groupFormViewModel(id: String?): AdminGroupFormViewModel =
        AdminGroupFormViewModel(repository, auth, id).also { activate(it.container.stateFlow) }

    private fun TestScope.poolFormViewModel(
        groupId: String,
        id: String?,
    ): AdminPoolFormViewModel =
        AdminPoolFormViewModel(repository, auth, groupId, id).also {
            activate(it.container.stateFlow)
        }

    private fun TestScope.activate(flow: StateFlow<*>) {
        backgroundScope.launch(dispatcher) { flow.collect {} }
    }
}

private fun <T> space.ivlev.umbravpn.domain.model.account.AccountResult<T>.requireValue(): T =
    (this as space.ivlev.umbravpn.domain.model.account.AccountResult.Success).value
