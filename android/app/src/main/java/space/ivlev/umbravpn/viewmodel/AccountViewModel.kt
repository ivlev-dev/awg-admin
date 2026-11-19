package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.data.account.AccountSnapshotCache
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountMessages
import space.ivlev.umbravpn.domain.account.ActionResult
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.pageDevices
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.ui.state.AccountDevicesState
import space.ivlev.umbravpn.ui.state.AccountDialog
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.ui.state.AccountUiState
import space.ivlev.umbravpn.util.network.ServerUrlValidation
import space.ivlev.umbravpn.util.network.validateServerUrl

class AccountViewModel(
    private val authRepository: AuthRepository,
    private val settingsRepository: AccountSettingsRepository,
    private val accountActions: AccountActions,
    private val syncService: ManagedTunnelSyncService,
    private val logoutCoordinator: LogoutCoordinator,
    private val autoConnector: ManagedTunnelAutoConnector,
    private val snapshotCache: AccountSnapshotCache,
) : OrbitContainerHost<AccountUiState, AccountUiState, AccountSideEffect>, ViewModel() {

    private var devicesSearchJob: Job? = null
    private var devicesRequestSeq = 0

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
                            devicesSearchJob?.cancel()
                            reduce {
                                state.copy(
                                    snapshot = null,
                                    isLoading = false,
                                    isRefreshing = false,
                                    dialog = null,
                                    pendingCreateKey = null,
                                    pendingTunnelKey = null,
                                    deviceList = AccountDevicesState(),
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

    fun refreshDevices() = intent { loadDevicesPage(reset = true) }

    fun loadMoreDevices() = intent { loadDevicesPage(reset = false) }

    fun setDevicesQuery(query: String) = intent {
        if (state.deviceList.query == query) return@intent
        reduce {
            state.copy(deviceList = state.deviceList.copy(query = query, offset = 0, error = null))
        }
        devicesSearchJob?.cancel()
        devicesSearchJob = viewModelScope.launch {
            delay(DEVICES_SEARCH_DEBOUNCE_MS)
            intent { loadDevicesPage(reset = true) }
        }
    }

    fun setDevicesStatus(status: DeviceStatusFilter) = intent {
        if (state.deviceList.status == status) return@intent
        devicesSearchJob?.cancel()
        reduce {
            state.copy(
                deviceList = state.deviceList.copy(status = status, offset = 0, error = null),
            )
        }
        loadDevicesPage(reset = true)
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

    fun showRenameTunnel(deviceId: String, peerId: String, label: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AccountDialog.RenameTunnel(deviceId, peerId, label),
                dialogError = null,
            )
        }
    }

    fun showLogout() = intent { reduce { state.copy(dialog = AccountDialog.Logout) } }

    fun showChangeServer() = intent {
        reduce { state.copy(dialog = AccountDialog.ChangeServer, dialogError = null) }
    }

    fun showEditFullName() = intent {
        if (state.isActionInProgress) return@intent
        reduce {
            state.copy(
                dialog = AccountDialog.EditFullName(state.snapshot?.user?.fullName.orEmpty()),
                dialogError = null,
            )
        }
    }

    fun updateFullName(fullName: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }

        when (val outcome = accountActions.updateFullName(fullName)) {
            is ActionResult.Success -> {
                reduce {
                    val updated = state.snapshot?.copy(user = outcome.value)
                    state.copy(
                        snapshot = updated,
                        session =
                            if (state.session is SessionState.Active) {
                                SessionState.Active(outcome.value)
                            } else {
                                state.session
                            },
                        isActionInProgress = false,
                        dialog = null,
                        dialogError = null,
                    )
                }
                postSideEffect(AccountSideEffect.Notice(AccountMessage.FullNameUpdated))
            }
            is ActionResult.Failure ->
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
        }
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
                reduce {
                    state
                        .replaceDevice(outcome.value.device)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
                            pendingCreateKey = null,
                            pendingTunnelKey = null,
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
                reduce {
                    state
                        .replaceDevice(outcome.value)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
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
                reduce {
                    state
                        .removeDevice(id)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
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
                reduce {
                    state
                        .replaceDevice(outcome.value.device)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
                            pendingTunnelKey = null,
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
                reduce {
                    state
                        .removeDevicePeer(deviceId, peerId)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
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

    fun renameTunnel(deviceId: String, peerId: String, label: String) = intent {
        if (state.isActionInProgress) return@intent
        reduce { state.copy(isActionInProgress = true, dialogError = null) }

        when (val outcome = accountActions.renameDeviceTunnel(deviceId, peerId, label)) {
            is ActionResult.Success -> {
                reduce {
                    state
                        .replaceDevice(outcome.value)
                        .copy(
                            isActionInProgress = false,
                            dialog = null,
                            dialogError = null,
                        )
                }
                syncTunnels()
                postSideEffect(AccountSideEffect.Notice(AccountMessage.TunnelRenamed))
            }
            is ActionResult.Failure -> {
                reduce { state.copy(isActionInProgress = false, dialogError = outcome.message) }
                postSideEffect(
                    AccountSideEffect.Notice(outcome.message, isError = true),
                )
            }
        }
    }

    fun logout() = intent {
        if (state.isActionInProgress) return@intent
        devicesSearchJob?.cancel()
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        logoutCoordinator.logout()
        snapshotCache.clear()
        reduce {
            state.copy(
                isActionInProgress = false,
                dialog = null,
                pendingCreateKey = null,
                pendingTunnelKey = null,
                snapshot = null,
                error = null,
                deviceList = AccountDevicesState(),
            )
        }
        postSideEffect(AccountSideEffect.SignedOut)
        postSideEffect(AccountSideEffect.Notice(AccountMessage.LoggedOut))
    }

    fun changeServer(url: String) = intent {
        if (state.isActionInProgress) return@intent
        val validation = validateServerUrl(url, allowHttp = BuildConfig.ALLOW_HTTP_SERVER_URL)
        if (validation is ServerUrlValidation.Invalid) {
            reduce { state.copy(dialogError = AccountMessages.ofServerUrl(validation.error)) }
            return@intent
        }
        validation as ServerUrlValidation.Valid

        devicesSearchJob?.cancel()
        reduce { state.copy(isActionInProgress = true, dialogError = null) }
        logoutCoordinator.logout()
        snapshotCache.clear()
        settingsRepository.setServerUrl(validation.url)
        reduce {
            state.copy(
                isActionInProgress = false,
                dialog = null,
                pendingCreateKey = null,
                pendingTunnelKey = null,
                snapshot = null,
                error = null,
                serverUrl = validation.url,
                deviceList = AccountDevicesState(),
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
            is ActionResult.Success -> {
                snapshotCache.save(outcome.value)
                reduce {
                    state.copy(
                        snapshot = outcome.value,
                        isLoading = false,
                        isRefreshing = false,
                        error = null,
                    )
                }
                loadDevicesPage(reset = true)
            }
            is ActionResult.Failure -> {
                val cached =
                    if (outcome.message == AccountMessage.Network && state.snapshot == null) {
                        snapshotCache.load()
                    } else {
                        null
                    }
                reduce {
                    state.copy(
                        snapshot = cached ?: state.snapshot,
                        isLoading = false,
                        isRefreshing = false,
                        error = outcome.message,
                    )
                }
                seedDevicesFromSnapshot(outcome.message)
            }
        }
    }

    private suspend fun Syntax<AccountUiState, AccountSideEffect>.loadDevicesPage(reset: Boolean) {
        val current = state.deviceList
        if (!reset && (current.isLoading || current.isLoadingMore || !current.canLoadMore)) return

        val request =
            DeviceQuery(
                    limit = current.limit,
                    offset = if (reset) 0 else current.items.size,
                    query = current.query,
                    status = current.status,
                )
                .normalized
        val requestSeq = ++devicesRequestSeq

        reduce {
            state.copy(
                deviceList =
                    state.deviceList.copy(
                        isLoading = reset,
                        isLoadingMore = !reset,
                        error = null,
                    ),
            )
        }

        when (val outcome = accountActions.pageDevices(request)) {
            is ActionResult.Success ->
                reduce {
                    if (requestSeq != devicesRequestSeq || !state.deviceList.matches(request)) {
                        state
                    } else {
                        val page = outcome.value
                        val items =
                            if (reset) page.items.distinctBy { it.id }
                            else mergeDevices(state.deviceList.items, page.items)
                        val total =
                            if (!reset && page.items.isEmpty()) items.size
                            else maxOf(page.total, items.size)
                        state.copy(
                            deviceList =
                                state.deviceList.copy(
                                    items = items,
                                    total = total,
                                    offset = items.size,
                                    isLoading = false,
                                    isLoadingMore = false,
                                    error = null,
                                    isLoaded = true,
                                ),
                        )
                    }
                }
            is ActionResult.Failure ->
                reduce {
                    if (requestSeq != devicesRequestSeq || !state.deviceList.matches(request)) {
                        state
                    } else {
                        val local = state.snapshot
                        val seed =
                            if (state.deviceList.items.isEmpty() && local != null) {
                                local.devices.pageDevices(request)
                            } else {
                                null
                            }
                        state.copy(
                            deviceList =
                                state.deviceList.copy(
                                    items = seed?.items ?: state.deviceList.items,
                                    total =
                                        if (seed != null && local != null) {
                                            maxOf(local.deviceCount, seed.total)
                                        } else {
                                            state.deviceList.total
                                        },
                                    offset = seed?.items?.size ?: state.deviceList.offset,
                                    isLoading = false,
                                    isLoadingMore = false,
                                    error = outcome.message,
                                    isLoaded =
                                        seed != null ||
                                            state.deviceList.isLoaded ||
                                            state.deviceList.items.isNotEmpty(),
                                ),
                        )
                    }
                }
        }
    }

    private suspend fun Syntax<AccountUiState, AccountSideEffect>.seedDevicesFromSnapshot(
        message: AccountMessage?,
    ) {
        val snapshot = state.snapshot ?: return
        if (state.deviceList.isLoaded || state.deviceList.items.isNotEmpty()) return
        val request =
            DeviceQuery(
                    limit = state.deviceList.limit,
                    offset = 0,
                    query = state.deviceList.query,
                    status = state.deviceList.status,
                )
                .normalized
        val page = snapshot.devices.pageDevices(request)
        reduce {
            state.copy(
                deviceList =
                    state.deviceList.copy(
                        items = page.items,
                        total = maxOf(snapshot.deviceCount, page.total),
                        offset = page.items.size,
                        isLoading = false,
                        isLoadingMore = false,
                        error = message,
                        isLoaded = page.items.isNotEmpty(),
                    ),
            )
        }
    }

    private fun AccountUiState.replaceDevice(device: AccountDevice): AccountUiState =
        copy(
            snapshot = snapshot?.replaceDevice(device),
            deviceList = deviceList.replaceItem(device),
        )

    private fun AccountUiState.removeDevice(id: String): AccountUiState =
        copy(
            snapshot =
                snapshot?.let { current ->
                    if (current.devices.none { it.id == id }) {
                        current
                    } else {
                        current.copy(
                            devices = current.devices.filterNot { it.id == id },
                            devicesTotal = current.devicesTotal?.minus(1),
                        )
                    }
                },
            deviceList = deviceList.removeItem(id),
        )

    private fun AccountUiState.removeDevicePeer(
        deviceId: String,
        peerId: String,
    ): AccountUiState =
        copy(
            snapshot = snapshot?.removeDevicePeer(deviceId, peerId),
            deviceList = deviceList.removePeer(deviceId, peerId),
        )

    private fun AccountSnapshot.replaceDevice(device: AccountDevice): AccountSnapshot {
        if (devices.none { it.id == device.id }) {
            return copy(devices = devices + device, devicesTotal = devicesTotal?.plus(1))
        }
        return copy(devices = devices.map { if (it.id == device.id) device else it })
    }

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

    private fun mergeDevices(
        existing: List<AccountDevice>,
        incoming: List<AccountDevice>,
    ): List<AccountDevice> {
        if (incoming.isEmpty()) return existing
        val seen = existing.mapTo(HashSet(existing.size)) { it.id }
        val merged = existing.toMutableList()
        incoming.forEach { device -> if (seen.add(device.id)) merged += device }
        return merged
    }
}

private const val DEVICES_SEARCH_DEBOUNCE_MS = 300L

private fun AccountDevicesState.matches(request: DeviceQuery): Boolean =
    query.trim() == request.query && status == request.status

private fun AccountDevicesState.replaceItem(device: AccountDevice): AccountDevicesState {
    if (!isLoaded) return this
    val index = items.indexOfFirst { it.id == device.id }
    if (index >= 0) {
        return copy(items = items.toMutableList().also { it[index] = device })
    }
    val accepted = DeviceQuery(limit = limit, query = query, status = status).matches(device)
    if (!accepted) return this
    val next = listOf(device) + items
    return copy(items = next, total = total + 1, offset = next.size)
}

private fun AccountDevicesState.removeItem(id: String): AccountDevicesState {
    if (!isLoaded || items.none { it.id == id }) return this
    val next = items.filterNot { it.id == id }
    return copy(items = next, total = (total - 1).coerceAtLeast(0), offset = next.size)
}

private fun AccountDevicesState.removePeer(
    deviceId: String,
    peerId: String,
): AccountDevicesState {
    if (items.none { it.id == deviceId }) return this
    return copy(
        items =
            items.map { device ->
                if (device.id != deviceId) {
                    device
                } else {
                    device.copy(peers = device.peers.filterNot { it.peerId == peerId })
                }
            },
    )
}
