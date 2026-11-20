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
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminCatalogs
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminFormSideEffect
import space.ivlev.umbravpn.ui.state.AdminTariffFormUiState
import space.ivlev.umbravpn.ui.state.AdminUserFormUiState

class AdminUserFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val userId: String?,
) :
    OrbitContainerHost<AdminUserFormUiState, AdminUserFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminUserFormUiState, AdminFormSideEffect>(
            AdminUserFormUiState(id = userId),
        ) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true, isLoading = false) }
                    return@intent
                }
                reduce { state.copy(isLoading = true, error = null) }
                loadCatalogs()
                if (userId != null) {
                    when (val result = repository.user(userId)) {
                        is AccountResult.Success ->
                            reduce {
                                state.copy(
                                    email = result.value.email,
                                    fullName = result.value.fullName.orEmpty(),
                                    role = result.value.role,
                                    tariffId = result.value.tariffId,
                                    nodeId = result.value.nodeId,
                                    groupId = result.value.groupId,
                                    disabled = result.value.disabled,
                                    isLoading = false,
                                )
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

    fun onEmailChange(value: String) = intent {
        reduce { state.copy(email = value, emailError = null, error = null) }
    }

    fun onFullNameChange(value: String) = intent {
        reduce { state.copy(fullName = value, fullNameError = null, error = null) }
    }

    fun onPasswordChange(value: String) = intent {
        reduce { state.copy(password = value, passwordError = null, error = null) }
    }

    fun onRoleChange(role: UserRole) = intent {
        if (role == UserRole.Unknown) return@intent
        reduce { state.copy(role = role, error = null) }
    }

    fun onTariffChange(id: String?) = intent { reduce { state.copy(tariffId = id, error = null) } }

    fun onNodeChange(id: String?) = intent { reduce { state.copy(nodeId = id, error = null) } }

    fun onGroupChange(id: String?) = intent { reduce { state.copy(groupId = id, error = null) } }

    fun onDisabledChange(disabled: Boolean) = intent {
        reduce { state.copy(disabled = disabled, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val emailError = AdminValidation.emailError(state.email)
        val passwordError =
            if (state.isEditing) null else AdminValidation.passwordError(state.password)
        val fullNameError = AdminValidation.optionalFullNameError(state.fullName)
        if (emailError != null || passwordError != null || fullNameError != null) {
            reduce {
                state.copy(
                    emailError = emailError,
                    passwordError = passwordError,
                    fullNameError = fullNameError,
                )
            }
            return@intent
        }

        val draft =
            AdminUserDraft(
                email = state.email.trim(),
                fullName = state.fullName.trim().takeIf { it.isNotEmpty() },
                role = state.role,
                tariffId = state.tariffId,
                nodeId = state.nodeId,
                groupId = state.groupId,
                disabled = state.disabled,
                password = if (state.isEditing) null else state.password,
            )
        reduce { state.copy(isSaving = true, error = null) }

        val result =
            if (userId == null) repository.createUser(draft)
            else repository.updateUser(userId, draft)

        when (result) {
            is AccountResult.Success -> {
                reduce { state.copy(isSaving = false) }
                postSideEffect(AdminFormSideEffect.Saved)
            }
            is AccountResult.Failure ->
                reduce { state.copy(isSaving = false, error = AdminMessages.of(result.error)) }
        }
    }

    private suspend fun Syntax<AdminUserFormUiState, AdminFormSideEffect>.loadCatalogs() {
        val tariffs = repository.listTariffs()
        val nodes = repository.listNodes()
        val groups = repository.listGroups()
        reduce {
            state.copy(
                catalogs =
                    AdminCatalogs(
                        tariffs =
                            (tariffs as? AccountResult.Success)?.value.orEmpty().map {
                                AdminOption(it.id, it.name)
                            },
                        nodes = (nodes as? AccountResult.Success)?.value.orEmpty(),
                        groups = (groups as? AccountResult.Success)?.value.orEmpty(),
                    ),
            )
        }
    }

    fun clearError() = intent { reduce { state.copy(error = null) } }
}

class AdminTariffFormViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
    private val tariffId: String?,
) :
    OrbitContainerHost<AdminTariffFormUiState, AdminTariffFormUiState, AdminFormSideEffect>,
    ViewModel() {

    override val container =
        orbitContainer<AdminTariffFormUiState, AdminFormSideEffect>(
            AdminTariffFormUiState(id = tariffId),
        ) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true, isLoading = false) }
                    return@intent
                }
                reduce { state.copy(isLoading = true, error = null) }
                loadInterfaces()
                if (tariffId != null) {
                    when (val result = repository.listTariffs()) {
                        is AccountResult.Success -> {
                            val tariff = result.value.firstOrNull { it.id == tariffId }
                            if (tariff == null) {
                                reduce {
                                    state.copy(
                                        isLoading = false,
                                        error = AdminMessage.NotFound,
                                    )
                                }
                            } else {
                                reduce {
                                    state.copy(
                                        name = tariff.name,
                                        description = tariff.description,
                                        maxDevices = tariff.maxDevices.toString(),
                                        deviceDownKbps = tariff.deviceDownKbps.toString(),
                                        deviceUpKbps = tariff.deviceUpKbps.toString(),
                                        quotaGb =
                                            AdminValidation.quotaGigabytes(
                                                tariff.trafficQuotaBytes,
                                            ),
                                        interfaceId = tariff.interfaceId,
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

    fun onNameChange(value: String) = intent {
        reduce { state.copy(name = value, nameError = null, error = null) }
    }

    fun onDescriptionChange(value: String) = intent {
        reduce { state.copy(description = value, error = null) }
    }

    fun onMaxDevicesChange(value: String) = intent {
        reduce { state.copy(maxDevices = value, maxDevicesError = null, error = null) }
    }

    fun onDownChange(value: String) = intent {
        reduce { state.copy(deviceDownKbps = value, speedError = null, error = null) }
    }

    fun onUpChange(value: String) = intent {
        reduce { state.copy(deviceUpKbps = value, speedError = null, error = null) }
    }

    fun onQuotaChange(value: String) = intent {
        reduce { state.copy(quotaGb = value, quotaError = null, error = null) }
    }

    fun onInterfaceChange(id: String?) = intent {
        reduce { state.copy(interfaceId = id, error = null) }
    }

    fun save() = intent {
        if (state.isSaving) return@intent
        val nameError = AdminValidation.tariffNameError(state.name)
        val maxDevicesError = AdminValidation.maxDevicesError(state.maxDevices)
        val speedError = AdminValidation.speedError(state.deviceDownKbps, state.deviceUpKbps)
        val quotaError = AdminValidation.quotaError(state.quotaGb)
        if (
            nameError != null || maxDevicesError != null || speedError != null || quotaError != null
        ) {
            reduce {
                state.copy(
                    nameError = nameError,
                    maxDevicesError = maxDevicesError,
                    speedError = speedError,
                    quotaError = quotaError,
                )
            }
            return@intent
        }

        val draft =
            AdminTariffDraft(
                name = state.name.trim(),
                description = state.description.trim(),
                maxDevices = state.maxDevices.trim().toInt(),
                deviceDownKbps = state.deviceDownKbps.trim().toInt(),
                deviceUpKbps = state.deviceUpKbps.trim().toInt(),
                trafficQuotaBytes = AdminValidation.quotaBytes(state.quotaGb),
                interfaceId = state.interfaceId,
            )
        reduce { state.copy(isSaving = true, error = null) }

        val result =
            if (tariffId == null) repository.createTariff(draft)
            else repository.updateTariff(tariffId, draft)

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

    private suspend fun Syntax<AdminTariffFormUiState, AdminFormSideEffect>.loadInterfaces() {
        when (val result = repository.listInterfaces()) {
            is AccountResult.Success -> reduce { state.copy(interfaces = result.value) }
            is AccountResult.Failure -> Unit
        }
    }
}
