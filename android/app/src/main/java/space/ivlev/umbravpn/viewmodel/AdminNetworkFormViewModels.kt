package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.AdminValidation
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminGroupDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceUpdate
import space.ivlev.umbravpn.domain.model.admin.AdminNodeDraft
import space.ivlev.umbravpn.domain.model.admin.AdminPoolDraft
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.domain.model.admin.AdminPoolUpdate
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminFormSideEffect
import space.ivlev.umbravpn.ui.state.AdminGroupFormUiState
import space.ivlev.umbravpn.ui.state.AdminInterfaceFormUiState
import space.ivlev.umbravpn.ui.state.AdminNodeFormUiState
import space.ivlev.umbravpn.ui.state.AdminPoolFormUiState
import space.ivlev.umbravpn.ui.state.AdminTokenReason
import space.ivlev.umbravpn.ui.state.AdminTokenReveal

class AdminNodeFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) :
    OrbitContainerHost<AdminNodeFormUiState, AdminNodeFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminNodeFormUiState, AdminFormSideEffect>(AdminNodeFormUiState()) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true) }
                }
            }
        }

    fun onNameChange(value: String) = intent {
        reduce { state.copy(name = value, nameError = null, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val nameError = AdminValidation.nodeNameError(state.name)
        if (nameError != null) {
            reduce { state.copy(nameError = nameError) }
            return@intent
        }
        reduce { state.copy(isSaving = true, error = null) }
        when (val result = repository.createNode(AdminNodeDraft(state.name.trim()))) {
            is AccountResult.Success ->
                reduce {
                    state.copy(
                        isSaving = false,
                        revealedToken =
                            AdminTokenReveal(
                                nodeName = result.value.nodeName,
                                token = result.value.token,
                                reason = AdminTokenReason.Created,
                            ),
                    )
                }
            is AccountResult.Failure ->
                reduce { state.copy(isSaving = false, error = AdminMessages.of(result.error)) }
        }
    }

    fun dismissToken() = intent {
        reduce { state.copy(revealedToken = null, created = true) }
        postSideEffect(AdminFormSideEffect.Saved)
    }

    fun clearError() = intent { reduce { state.copy(error = null) } }
}

class AdminInterfaceFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val interfaceId: String?,
) :
    OrbitContainerHost<AdminInterfaceFormUiState, AdminInterfaceFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminInterfaceFormUiState, AdminFormSideEffect>(
            AdminInterfaceFormUiState(id = interfaceId),
        ) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true, isLoading = false) }
                    return@intent
                }
                reduce { state.copy(isLoading = true, error = null) }
                loadCatalogs()
                if (interfaceId != null) {
                    when (val result = repository.interfaces()) {
                        is AccountResult.Success -> {
                            val item = result.value.firstOrNull { it.id == interfaceId }
                            if (item == null) {
                                reduce {
                                    state.copy(isLoading = false, error = AdminMessage.NotFound)
                                }
                            } else {
                                reduce {
                                    state.copy(
                                        groupId = item.groupId,
                                        nodeId = item.nodeId,
                                        name = item.name,
                                        label = item.label,
                                        endpointHost = item.endpointHost,
                                        endpointPort = item.endpointPort.toString(),
                                        listenPort = item.listenPort.toString(),
                                        mtu = item.mtu.toString(),
                                        enabled = item.enabled,
                                        isLoading = false,
                                    )
                                }
                            }
                        }
                        is AccountResult.Failure ->
                            reduce {
                                state.copy(
                                    isLoading = false,
                                    error = AdminMessages.of(result.error),
                                )
                            }
                    }
                } else {
                    reduce { state.copy(isLoading = false) }
                }
            }
        }

    fun onGroupChange(id: String?) = intent {
        reduce { state.copy(groupId = id, groupError = null, error = null) }
    }

    fun onNodeChange(id: String?) = intent {
        reduce { state.copy(nodeId = id, nodeError = null, error = null) }
    }

    fun onNameChange(value: String) = intent {
        reduce { state.copy(name = value, nameError = null, error = null) }
    }

    fun onLabelChange(value: String) = intent { reduce { state.copy(label = value, error = null) } }

    fun onHostChange(value: String) = intent {
        reduce { state.copy(endpointHost = value, hostError = null, error = null) }
    }

    fun onEndpointPortChange(value: String) = intent {
        reduce { state.copy(endpointPort = value, endpointPortError = null, error = null) }
    }

    fun onListenPortChange(value: String) = intent {
        reduce { state.copy(listenPort = value, listenPortError = null, error = null) }
    }

    fun onMtuChange(value: String) = intent {
        reduce { state.copy(mtu = value, mtuError = null, error = null) }
    }

    fun onEnabledChange(enabled: Boolean) = intent {
        reduce { state.copy(enabled = enabled, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val groupError =
            if (state.isEditing) null else AdminValidation.groupSelectionError(state.groupId)
        val nodeError =
            if (state.isEditing) null else AdminValidation.nodeSelectionError(state.nodeId)
        val nameError =
            if (state.isEditing) null else AdminValidation.interfaceNameError(state.name)
        val hostError = AdminValidation.hostError(state.endpointHost)
        val endpointPortError = AdminValidation.portError(state.endpointPort)
        val listenPortError = AdminValidation.portError(state.listenPort)
        val mtuError = AdminValidation.mtuError(state.mtu)
        if (
            groupError != null ||
                nodeError != null ||
                nameError != null ||
                hostError != null ||
                endpointPortError != null ||
                listenPortError != null ||
                mtuError != null
        ) {
            reduce {
                state.copy(
                    groupError = groupError,
                    nodeError = nodeError,
                    nameError = nameError,
                    hostError = hostError,
                    endpointPortError = endpointPortError,
                    listenPortError = listenPortError,
                    mtuError = mtuError,
                )
            }
            return@intent
        }

        reduce { state.copy(isSaving = true, error = null) }
        val result =
            if (interfaceId == null) {
                repository.createInterface(
                    AdminInterfaceDraft(
                        groupId = state.groupId.orEmpty(),
                        nodeId = state.nodeId.orEmpty(),
                        name = state.name.trim(),
                        label = state.label.trim(),
                        endpointHost = state.endpointHost.trim(),
                        endpointPort = state.endpointPort.trim().toInt(),
                        listenPort = state.listenPort.trim().toInt(),
                        mtu = state.mtu.trim().toInt(),
                    ),
                )
            } else {
                repository.updateInterface(
                    interfaceId,
                    AdminInterfaceUpdate(
                        label = state.label.trim(),
                        endpointHost = state.endpointHost.trim(),
                        endpointPort = state.endpointPort.trim().toInt(),
                        listenPort = state.listenPort.trim().toInt(),
                        mtu = state.mtu.trim().toInt(),
                        enabled = state.enabled,
                    ),
                )
            }

        when (result) {
            is AccountResult.Success -> {
                reduce { state.copy(isSaving = false) }
                postSideEffect(AdminFormSideEffect.Saved)
            }
            is AccountResult.Failure ->
                reduce { state.copy(isSaving = false, error = AdminMessages.of(result.error)) }
        }
    }

    fun clearError() = intent { reduce { state.copy(error = null) } }

    private suspend fun Syntax<AdminInterfaceFormUiState, AdminFormSideEffect>.loadCatalogs() {
        val nodes = repository.listNodes()
        val groups = repository.listGroups()
        reduce {
            state.copy(
                nodes = (nodes as? AccountResult.Success)?.value.orEmpty(),
                groups = (groups as? AccountResult.Success)?.value.orEmpty(),
            )
        }
    }
}

class AdminGroupFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val groupId: String?,
) :
    OrbitContainerHost<AdminGroupFormUiState, AdminGroupFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminGroupFormUiState, AdminFormSideEffect>(
            AdminGroupFormUiState(id = groupId),
        ) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true, isLoading = false) }
                    return@intent
                }
                if (groupId == null) return@intent
                reduce { state.copy(isLoading = true, error = null) }
                when (val result = repository.groups()) {
                    is AccountResult.Success -> {
                        val group = result.value.firstOrNull { it.id == groupId }
                        if (group == null) {
                            reduce { state.copy(isLoading = false, error = AdminMessage.NotFound) }
                        } else {
                            reduce {
                                state.copy(
                                    name = group.name,
                                    description = group.description,
                                    baseCidr = group.baseCidr,
                                    forwardingDefault = group.forwardingDefault,
                                    isLoading = false,
                                )
                            }
                        }
                    }
                    is AccountResult.Failure ->
                        reduce {
                            state.copy(
                                isLoading = false,
                                error = AdminMessages.of(result.error),
                            )
                        }
                }
            }
        }

    fun onNameChange(value: String) = intent {
        reduce { state.copy(name = value, nameError = null, error = null) }
    }

    fun onDescriptionChange(value: String) = intent {
        reduce { state.copy(description = value, error = null) }
    }

    fun onCidrChange(value: String) = intent {
        reduce { state.copy(baseCidr = value, cidrError = null, error = null) }
    }

    fun onForwardingChange(value: Boolean) = intent {
        reduce { state.copy(forwardingDefault = value, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val nameError = AdminValidation.groupNameError(state.name)
        val cidrError = AdminValidation.cidrError(state.baseCidr)
        if (nameError != null || cidrError != null) {
            reduce { state.copy(nameError = nameError, cidrError = cidrError) }
            return@intent
        }
        val draft =
            AdminGroupDraft(
                name = state.name.trim(),
                description = state.description.trim(),
                baseCidr = state.baseCidr.trim(),
                forwardingDefault = state.forwardingDefault,
            )
        reduce { state.copy(isSaving = true, error = null) }
        val result =
            if (groupId == null) repository.createGroup(draft)
            else repository.updateGroup(groupId, draft)
        when (result) {
            is AccountResult.Success -> {
                reduce { state.copy(isSaving = false) }
                postSideEffect(AdminFormSideEffect.Saved)
            }
            is AccountResult.Failure ->
                reduce { state.copy(isSaving = false, error = AdminMessages.of(result.error)) }
        }
    }

    fun clearError() = intent { reduce { state.copy(error = null) } }
}

class AdminPoolFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val groupId: String,
    private val poolId: String?,
) :
    OrbitContainerHost<AdminPoolFormUiState, AdminPoolFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminPoolFormUiState, AdminFormSideEffect>(
            AdminPoolFormUiState(groupId = groupId, id = poolId),
        ) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true, isLoading = false) }
                    return@intent
                }
                if (poolId == null) return@intent
                reduce { state.copy(isLoading = true, error = null) }
                when (val result = repository.pools(groupId)) {
                    is AccountResult.Success -> {
                        val pool = result.value.firstOrNull { it.id == poolId }
                        if (pool == null) {
                            reduce { state.copy(isLoading = false, error = AdminMessage.NotFound) }
                        } else {
                            reduce {
                                state.copy(
                                    name = pool.name,
                                    cidr = pool.cidr,
                                    gateway = pool.gateway.orEmpty(),
                                    mode = pool.mode,
                                    enabled = pool.enabled,
                                    isLoading = false,
                                )
                            }
                        }
                    }
                    is AccountResult.Failure ->
                        reduce {
                            state.copy(
                                isLoading = false,
                                error = AdminMessages.of(result.error),
                            )
                        }
                }
            }
        }

    fun onNameChange(value: String) = intent {
        reduce { state.copy(name = value, nameError = null, error = null) }
    }

    fun onCidrChange(value: String) = intent {
        reduce { state.copy(cidr = value, cidrError = null, error = null) }
    }

    fun onGatewayChange(value: String) = intent {
        reduce { state.copy(gateway = value, gatewayError = null, error = null) }
    }

    fun onModeChange(mode: AdminPoolMode) = intent {
        reduce { state.copy(mode = mode, error = null) }
    }

    fun onEnabledChange(enabled: Boolean) = intent {
        reduce { state.copy(enabled = enabled, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val nameError = if (poolId == null) AdminValidation.groupNameError(state.name) else null
        val cidrError = AdminValidation.cidrError(state.cidr)
        val gatewayError = AdminValidation.gatewayError(state.gateway)
        if (nameError != null || cidrError != null || gatewayError != null) {
            reduce {
                state.copy(
                    nameError = nameError,
                    cidrError = cidrError,
                    gatewayError = gatewayError,
                )
            }
            return@intent
        }
        val gateway = state.gateway.trim().takeIf { it.isNotEmpty() }
        reduce { state.copy(isSaving = true, error = null) }
        val result =
            if (poolId == null) {
                repository.createPool(
                    groupId,
                    AdminPoolDraft(
                        name = state.name.trim(),
                        cidr = state.cidr.trim(),
                        mode = state.mode,
                        gateway = gateway,
                    ),
                )
            } else {
                repository.updatePool(
                    poolId,
                    AdminPoolUpdate(
                        mode = state.mode,
                        gateway = gateway,
                        enabled = state.enabled,
                    ),
                )
            }
        when (result) {
            is AccountResult.Success -> {
                reduce { state.copy(isSaving = false) }
                postSideEffect(AdminFormSideEffect.Saved)
            }
            is AccountResult.Failure ->
                reduce { state.copy(isSaving = false, error = AdminMessages.of(result.error)) }
        }
    }

    fun clearError() = intent { reduce { state.copy(error = null) } }
}
