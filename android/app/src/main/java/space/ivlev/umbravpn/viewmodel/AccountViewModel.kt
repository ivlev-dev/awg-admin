package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import java.util.UUID
import kotlinx.coroutines.flow.combine
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountMessages
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.ui.state.AccountDialog
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.util.network.ServerUrlValidation
import space.ivlev.umbravpn.util.network.validateServerUrl

class AccountViewModel(
    private val authRepository: AuthRepository,
    private val settingsRepository: AccountSettingsRepository,
    private val accountActions: AccountActions,
    private val authActions: AuthActions,
    private val syncService: ManagedTunnelSyncService,
    private val tunnelCleaner: ManagedTunnelCleanup,
    private val autoConnector: ManagedTunnelAutoConnector,
) : OrbitContainerHost<AccountUiState, AccountUiState, AccountSideEffect>, ViewModel() {

    override val container =
        orbitContainer<AccountUiState, AccountSideEffect>(AccountUiState()) {
            intent {
                combine(authRepository.session, settingsRepository.serverUrlFlow) { session, url ->
                        session to url
                    }
                    .collect { (session, url) ->
                        reduce { state.copy(session = session, serverUrl = url) }
                        val sessionAllowsProfile =
                            session is SessionState.Active || session is SessionState.Unknown
                        if (!sessionAllowsProfile) {
                            reduce {
                                state.copy(
                                    snapshot = null,
                                    isLoading = false,
                                    isRefreshing = false,
                                    dialog = null,
                                    pendingCreateKey = null,
                                    pendingTunnelKey = null,
                                )
                            }
                        }
                        if (state.snapshot == null && state.error == null) {
                            if (sessionAllowsProfile) {
                                loadNow(silent = false)
                            }
                        }
                    }
            }
        }

    fun refresh() = intent {
        if (state.isLoading || state.isRefreshing) return@intent
        syncTunnels()
        loadNow(silent = state.snapshot != null)
    }

    fun retry() = intent {
        reduce { state.copy(error = null) }
        loadNow(silent = false)
    }

    fun showAddDevice() = intent {
        val snapshot = state.snapshot
        if (snapshot != null) {
            if (snapshot.access.blocked) {
                postSideEffect(
                    AccountSideEffect.Notice(AccountMessage.AccountDisabled, isError = true),
                )
                return@intent
            }
            if (snapshot.tariff == null || snapshot.access.tariffMissing) {
                postSideEffect(
                    AccountSideEffect.Notice(AccountMessage.TariffRequired, isError = true),
                )
                return@intent
            }
        }
        reduce {
            state.copy(
                dialog = AccountDialog.AddDevice,
                dialogError = null,
                pendingCreateKey =
                    if (state.dialog is AccountDialog.AddDevice) {
                        state.pendingCreateKey
                    } else {
                        UUID.randomUUID().toString()
                    },
            )
        }
    }

    fun showRenameDevice(id: String, name: String) = intent {
        reduce { state.copy(dialog = AccountDialog.RenameDevice(id, name), dialogError = null) }
    }

    fun showDeleteDevice(id: String, name: String) = intent {
        reduce { state.copy(dialog = AccountDialog.DeleteDevice(id, name), dialogError = null) }
    }

    fun showAddTunnel(deviceId: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AccountDialog.AddTunnel(deviceId),
                dialogError = null,
                pendingTunnelKey =
                    if (state.dialog is AccountDialog.AddTunnel) {
                        state.pendingTunnelKey
                    } else {
                        UUID.randomUUID().toString()
                    },
            )
        }
    }

    fun showDeleteTunnel(deviceId: String, peerId: String, label: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AccountDialog.DeleteTunnel(deviceId, peerId, label),
                dialogError = null,
            )
        }
    }

    fun showLogout() = intent { reduce { state.copy(dialog = AccountDialog.Logout) } }

    fun showChangeServer() = intent {
        reduce { state.copy(dialog = AccountDialog.ChangeServer, dialogError = null) }
    }

    fun dismissDialog() = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = null,
                dialogError = null,
                pendingCreateKey = null,
                pendingTunnelKey = null,
            )
        }
    }

    fun createDevice(name: String, interfaceIds: List<String> = emptyList()) = intent {
        if (state.isActionInProgress) return@intent
        val createKey = state.pendingCreateKey ?: UUID.randomUUID().toString()
        reduce {
            state.copy(
                isActionInProgress = true,
                dialogError = null,
                pendingCreateKey = createKey,
            )
        }

        when (val outcome = accountActions.createDevice(name, interfaceIds, createKey)) {
            is ActionResult.Success -> {
                val snapshot = state.snapshot
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                        pendingCreateKey = null,
                        pendingTunnelKey = null,
                        snapshot =
                            snapshot?.copy(devices = snapshot.devices + outcome.value.device),
                    )
                }
                syncTunnels()
                autoConnector.ensureConnected()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.DeviceCreated))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
    }

    fun renameDevice(id: String, name: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }

        when (val outcome = accountActions.renameDevice(id, name)) {
            is ActionResult.Success -> {
                val snapshot = state.snapshot
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                        snapshot = snapshot?.replaceDevice(outcome.value),
                    )
                }
                syncTunnels()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.DeviceRenamed))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
    }

    fun deleteDevice(id: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }

        when (val outcome = accountActions.deleteDevice(id)) {
            is ActionResult.Success -> {
                val snapshot = state.snapshot
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                        snapshot =
                            snapshot?.copy(
                                devices = snapshot.devices.filterNot { it.id == id },
                            ),
                    )
                }
                syncTunnels()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.DeviceDeleted))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
    }

    fun addTunnel(deviceId: String, interfaceId: String, label: String) = intent {
        if (state.isActionInProgress) return@intent
        val tunnelKey = state.pendingTunnelKey ?: UUID.randomUUID().toString()
        reduce {
            state.copy(
                isActionInProgress = true,
                dialogError = null,
                pendingTunnelKey = tunnelKey,
            )
        }

        when (
            val outcome =
                accountActions.addDeviceTunnel(
                    deviceId = deviceId,
                    interfaceId = interfaceId,
                    label = label,
                    idempotencyKey = tunnelKey,
                )
        ) {
            is ActionResult.Success -> {
                val snapshot = state.snapshot
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                        pendingTunnelKey = null,
                        snapshot = snapshot?.replaceDevice(outcome.value.device),
                    )
                }
                syncTunnels()
                autoConnector.ensureConnected()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.TunnelAdded))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
    }

    fun deleteTunnel(deviceId: String, peerId: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }

        when (val outcome = accountActions.removeDeviceTunnel(deviceId, peerId)) {
            is ActionResult.Success -> {
                val snapshot = state.snapshot
                reduce {
                    state.copy(
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                        snapshot = snapshot?.removeDevicePeer(deviceId, peerId),
                    )
                }
                syncTunnels()
                autoConnector.ensureConnected()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.TunnelDeleted))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
    }

    fun logout() = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        authActions.logout()
        tunnelCleaner.clear()
        settingsRepository.setManagedProvisioned(false)
        reduce {
            state.copy(
                isActionInProgress = false,
                dialog = null,
                pendingCreateKey = null,
                pendingTunnelKey = null,
                snapshot = null,
                error = null,
            )
        }
        postSideEffect(AccountSideEffect.SignedOut)
        postSideEffect(AccountSideEffect.Notice(AccountMessage.LoggedOut))
    }

    fun changeServer(url: String) = intent {
        if (state.isActionInProgress) return@intent
        val validation = validateServerUrl(url)
        if (validation is ServerUrlValidation.Invalid) {
            reduce { state.copy(dialogError = AccountMessages.ofServerUrl(validation.error)) }
            return@intent
        }
        validation as ServerUrlValidation.Valid

        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        settingsRepository.setServerUrl(validation.url)
        authActions.logout()
        tunnelCleaner.clear()
        settingsRepository.setManagedProvisioned(false)
        reduce {
            state.copy(
                isActionInProgress = false,
                dialog = null,
                pendingCreateKey = null,
                pendingTunnelKey = null,
                snapshot = null,
                error = null,
                serverUrl = validation.url,
            )
        }
        postSideEffect(AccountSideEffect.SignedOut)
        postSideEffect(AccountSideEffect.Notice(AccountMessage.ServerChanged))
    }

    fun clearDialogError() = intent { reduce { state.copy(dialogError = null) } }

    fun clearError() = intent { reduce { state.copy(error = null) } }

    fun loadDeviceEndpoint(id: String) = intent {
        if (state.isEndpointLoading) return@intent
        reduce {
            state.copy(
                deviceEndpoint = null,
                endpointError = null,
                isEndpointLoading = true,
            )
        }
        when (val outcome = accountActions.deviceEndpoint(id)) {
            is ActionResult.Success ->
                reduce {
                    state.copy(
                        deviceEndpoint = outcome.value.ifBlank { null },
                        isEndpointLoading = false,
                    )
                }
            is ActionResult.Failure ->
                reduce { state.copy(isEndpointLoading = false, endpointError = outcome.message) }
        }
    }

    private suspend fun syncTunnels() {
        runCatching { syncService.sync() }
    }

    private suspend fun Syntax<AccountUiState, AccountSideEffect>.loadNow(silent: Boolean) {
        reduce { state.copy(isLoading = !silent, isRefreshing = silent, error = null) }
        when (val outcome = accountActions.bootstrap()) {
            is ActionResult.Success ->
                reduce {
                    state.copy(
                        snapshot = outcome.value,
                        isLoading = false,
                        isRefreshing = false,
                        error = null,
                    )
                }
            is ActionResult.Failure ->
                reduce {
                    state.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = outcome.message,
                    )
                }
        }
    }

    private fun AccountSnapshot.replaceDevice(device: AccountDevice): AccountSnapshot =
        copy(devices = devices.map { if (it.id == device.id) device else it })

    private fun AccountSnapshot.removeDevicePeer(
        deviceId: String,
        peerId: String,
    ): AccountSnapshot =
        copy(
            devices =
                devices.map { device ->
                    if (device.id != deviceId) {
                        device
                    } else {
                        device.copy(peers = device.peers.filterNot { it.peerId == peerId })
                    }
                },
        )
}
