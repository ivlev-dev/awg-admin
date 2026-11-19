package space.ivlev.umbravpn.viewmodel

import android.net.Uri
import androidx.appcompat.app.AppCompatDelegate
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dokar.sonner.ToastType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.orchestration.TunnelBackendCoordinator
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.core.tunnel.StrictSplitDefaults
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.SelectedTunnelsRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.domain.sideeffect.NotificationPendingAction
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.service.ServiceManager
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.ui.state.GlobalAppUiState
import space.ivlev.umbravpn.ui.theme.Theme
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.LocaleUtil
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.network.NetworkUtils
import space.ivlev.umbravpn.viewmodel.shared.ScreenUiRequests
import space.ivlev.umbravpn.viewmodel.shared.TunnelExportSupport
import space.ivlev.umbravpn.viewmodel.shared.TunnelGroupSupport
import space.ivlev.umbravpn.viewmodel.shared.TunnelReorderSupport
import space.ivlev.umbravpn.viewmodel.shared.TunnelSelectionSupport
import space.ivlev.umbravpn.viewmodel.shared.TunnelSyncSupport
import space.ivlev.umbravpn.viewmodel.shared.buildTunnelsUiStateFlow
import space.ivlev.umbravpn.viewmodel.shared.toChrome
import xyz.teamgravity.pin_lock_compose.PinManager

class SharedAppViewModel(
    private val appStateRepository: AppStateRepository,
    private val serviceManager: ServiceManager,
    private val tunnelCoordinator: TunnelCoordinator,
    private val globalEffectRepository: GlobalEffectRepository,
    private val tunnelRepository: TunnelRepository,
    private val tunnelGroupRepository: TunnelGroupRepository,
    private val managedTunnelRepository: ManagedTunnelRepository,
    private val managedTunnelSyncService: ManagedTunnelSyncService,
    private val settingsRepository: GeneralSettingRepository,
    private val selectedTunnelsRepository: SelectedTunnelsRepository,
    private val tunnelBackendCoordinator: TunnelBackendCoordinator,
    private val fileUtils: FileUtils,
    private val networkUtils: NetworkUtils,
    private val appLockManager: AppLockManager,
    private val strictSplitDefaults: StrictSplitDefaults,
    private val accountSettingsRepository: AccountSettingsRepository,
) : OrbitContainerHost<GlobalAppUiState, GlobalAppUiState, LocalSideEffect>, ViewModel() {

    val globalSideEffect = globalEffectRepository.flow

    private val uiRequests = ScreenUiRequests()
    val screenDirty: StateFlow<Boolean> = uiRequests.screenDirty

    fun setScreenDirty(dirty: Boolean) = uiRequests.setScreenDirty(dirty)

    val autoConnectOnStartup =
        accountSettingsRepository.autoConnectOnStartupFlow.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            true,
        )

    fun setAutoConnectOnStartup(enabled: Boolean) {
        viewModelScope.launch {
            accountSettingsRepository.setAutoConnectOnStartup(enabled)
            if (enabled) accountSettingsRepository.setManualDisconnect(false)
        }
    }

    val supportAutoUpdateRequests = uiRequests.supportAutoUpdateRequests

    fun requestSupportAutoUpdate(startDownload: Boolean) =
        uiRequests.requestSupportAutoUpdate(startDownload)

    val showUpdateStatusRequested: StateFlow<Boolean> = uiRequests.showUpdateStatusRequested

    fun requestShowUpdateStatus() = uiRequests.requestShowUpdateStatus()

    fun consumeShowUpdateStatus() = uiRequests.consumeShowUpdateStatus()

    val showSplitSystemApps: StateFlow<Boolean> = uiRequests.showSplitSystemApps

    fun prepareSplitSystemApps(tunnelId: Int) = uiRequests.prepareSplitSystemApps(tunnelId)

    fun setShowSplitSystemApps(show: Boolean) = uiRequests.setShowSplitSystemApps(show)

    fun clearSplitSystemApps(tunnelId: Int) = uiRequests.clearSplitSystemApps(tunnelId)

    val strictSplitNotice =
        strictSplitDefaults.notice.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000L),
            null,
        )

    fun acknowledgeStrictSplitNotice() = intent { strictSplitDefaults.acknowledge() }

    fun answerStrictSplitSuggestion(enable: Boolean) = intent {
        strictSplitDefaults.answer(enable)
        if (enable) tunnelCoordinator.restartActiveTunnels()
    }

    private val reorder =
        TunnelReorderSupport(
            tunnelRepository = tunnelRepository,
            tunnelGroupRepository = tunnelGroupRepository,
            networkUtils = networkUtils,
            tunnelCoordinator = tunnelCoordinator,
            globalEffectRepository = globalEffectRepository,
        )

    private val groups =
        TunnelGroupSupport(
            tunnelRepository = tunnelRepository,
            tunnelGroupRepository = tunnelGroupRepository,
            selectedTunnelsRepository = selectedTunnelsRepository,
            tunnelCoordinator = tunnelCoordinator,
            globalEffectRepository = globalEffectRepository,
        )

    private val selection =
        TunnelSelectionSupport(
            tunnelRepository = tunnelRepository,
            tunnelGroupRepository = tunnelGroupRepository,
            selectedTunnelsRepository = selectedTunnelsRepository,
            tunnelCoordinator = tunnelCoordinator,
            globalEffectRepository = globalEffectRepository,
        )

    private val export =
        TunnelExportSupport(fileUtils = fileUtils, globalEffectRepository = globalEffectRepository)

    private val sync =
        TunnelSyncSupport(
            managedTunnelSyncService = managedTunnelSyncService,
            globalEffectRepository = globalEffectRepository,
        )

    val isSyncingTunnels: StateFlow<Boolean> = sync.isSyncing

    fun refreshTunnels() = intent { sync.refresh() }

    val tunnelsUiState =
        buildTunnelsUiStateFlow(
            scope = viewModelScope,
            tunnelRepository = tunnelRepository,
            tunnelGroupRepository = tunnelGroupRepository,
            tunnelCoordinator = tunnelCoordinator,
            selectedTunnelsRepository = selectedTunnelsRepository,
            managedTunnelRepository = managedTunnelRepository,
            reorderDraft = reorder.draft,
            pingLatencies = reorder.latencies,
        )

    override val container =
        orbitContainer<GlobalAppUiState, LocalSideEffect>(
            GlobalAppUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5_000L },
        ) {
            intent {
                combine(
                        tunnelRepository.userTunnelsFlow
                            .map { tuns -> tuns.associate { it.id to it.name } }
                            .distinctUntilChanged(),
                        settingsRepository.flow,
                        tunnelsUiState.map { it.toChrome() }.distinctUntilChanged(),
                        appStateRepository.flow,
                    ) { tunNames, settings, chrome, appState ->
                        state.copy(
                            theme = settings.theme,
                            tunnelMode = settings.tunnelMode,
                            tunnelNames = tunNames,
                            alreadyDonated = settings.alreadyDonated,
                            isBatteryOptimizationShown = appState.isBatteryOptimizationDisableShown,
                            shouldShowDonationSnackbar = appState.shouldShowDonationSnackbar,
                            isDesktopPromptShown = appState.isDesktopPromptShown,
                            selectedTunnelCount = chrome.selectedTunCount,
                            canMoveToGroup = chrome.canMoveToGroup,
                            isReorderMode = chrome.isReorderMode,
                            reorderScopeTitle = chrome.reorderScopeTitle,
                            hasGroups = chrome.hasGroups,
                            canReorder = chrome.canReorder,
                            hasActiveTunnel = chrome.hasActiveTunnel,
                            pinLockEnabled = settings.isPinLockEnabled,
                            isScreenRecordingProtectionEnabled =
                                settings.screenRecordingSecurityEnabled,
                            isAppLoaded = !chrome.loading,
                        )
                    }
                    .collect { newState -> reduce { newState } }
            }
            intent {
                appLockManager.unlocked.collect { unlocked ->
                    reduce { state.copy(isPinVerified = unlocked) }
                }
            }
            intent {
                // Clear ping results when tunnel is active
                tunnelCoordinator.backendStatus
                    .map { it.activeTunnels.isNotEmpty() }
                    .distinctUntilChanged()
                    .collect { hasActiveTunnel -> if (hasActiveTunnel) reorder.clearLatencies() }
            }
        }

    fun startTunnel(tunnelConfig: TunnelConfig) = intent {
        if (state.tunnelMode == TunnelMode.VPN) {
            if (!serviceManager.hasVpnPermission())
                return@intent postSideEffect(
                    GlobalSideEffect.RequestVpnPermission(TunnelMode.VPN, tunnelConfig),
                )
        }
        if (
            !serviceManager.hasNotificationPermission() &&
                !appStateRepository.isNotificationPermissionRequested()
        ) {
            appStateRepository.setNotificationPermissionRequested(true)
            return@intent postSideEffect(
                GlobalSideEffect.RequestNotificationPermission(
                    NotificationPendingAction.StartTunnel(tunnelConfig),
                ),
            )
        }
        tunnelCoordinator.startTunnel(tunnelConfig)
    }

    fun postSideEffect(localSideEffect: LocalSideEffect) = intent {
        postSideEffect(localSideEffect)
    }

    fun setTheme(theme: Theme) = intent { settingsRepository.updateTheme(theme) }

    fun setLocale(locale: String) = intent {
        // pre-T the stored value is reapplied on startup, on T+ the system persists it
        if (!LocaleUtil.isSystemManaged) settingsRepository.updateLocale(locale)
        withContext(Dispatchers.Main) { LocaleUtil.changeLocale(locale) }
    }

    fun syncLocale() = intent {
        val stored = settingsRepository.flow.firstOrNull()?.locale ?: return@intent
        if (stored == LocaleUtil.OPTION_PHONE_LANGUAGE) return@intent
        if (LocaleUtil.isSystemManaged) {
            // one-time handoff to the system, without overriding a locale set in system settings
            if (AppCompatDelegate.getApplicationLocales().isEmpty) {
                withContext(Dispatchers.Main) { LocaleUtil.changeLocale(stored) }
            }
            settingsRepository.updateLocale(LocaleUtil.OPTION_PHONE_LANGUAGE)
        } else {
            withContext(Dispatchers.Main) { LocaleUtil.changeLocale(stored) }
        }
    }

    fun setPinLockEnabled(enabled: Boolean) = intent {
        if (!enabled) PinManager.clearPin()
        settingsRepository.updatePinLockEnabled(enabled)
    }

    fun stopTunnel(tunnelConfig: TunnelConfig) = intent {
        tunnelCoordinator.stopTunnel(tunnelConfig.id)
    }

    fun setAppMode(mode: TunnelMode) = intent {
        if (mode == TunnelMode.VPN || mode == TunnelMode.LOCK_DOWN) {
            if (!serviceManager.hasVpnPermission()) {
                return@intent postSideEffect(GlobalSideEffect.RequestVpnPermission(mode, null))
            }
        }

        tunnelBackendCoordinator.changeMode(mode)
    }

    fun setShouldShowDonationSnackbar(to: Boolean) = intent {
        appStateRepository.setShouldShowDonationSnackbar(to)
    }

    fun setDesktopPromptShown(shown: Boolean) = intent {
        appStateRepository.setDesktopPromptShown(shown)
    }

    fun showSnackMessage(message: StringValue, type: ToastType) = intent {
        postGlobalSideEffect(GlobalSideEffect.Snackbar(message, type))
    }

    suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }

    fun authenticated() = appLockManager.unlock()

    suspend fun postGlobalSideEffect(sideEffect: GlobalSideEffect) {
        globalEffectRepository.post(sideEffect)
    }

    fun disableBatteryOptimizationsShown() = intent {
        appStateRepository.setBatteryOptimizationDisableShown(true)
    }

    fun enterReorderMode() = intent {
        val ui = tunnelsUiState.value
        selection.clear()
        reorder.enter(ui.tunnels, ui.groups)
    }

    fun cancelReorder() = intent { reorder.cancel() }

    fun exitReorderScope() = intent { reorder.exitScope() }

    fun enterReorderScope(groupId: Int) = intent { reorder.enterScope(groupId) }

    fun applyReorderDraft(groups: List<TunnelGroup>, tunnels: List<TunnelConfig>) =
        reorder.applyDraft(groups, tunnels)

    fun saveReorder() = intent { reorder.save() }

    fun sortReorderByName() = intent { reorder.sortByName() }

    fun sortReorderByLatency() = intent { reorder.sortByLatency() }

    fun pingTunnels() = intent { reorder.pingAll() }

    fun createGroupAndMoveSelected(name: String) = intent {
        groups.createAndMoveSelected(tunnelsUiState.value, name)
    }

    fun renameGroup(group: TunnelGroup, name: String) = intent {
        groups.rename(tunnelsUiState.value, group, name)
    }

    fun toggleGroupExpanded(group: TunnelGroup) = intent { groups.toggleExpanded(group) }

    fun ungroup(group: TunnelGroup) = intent { groups.ungroup(tunnelsUiState.value, group) }

    fun deleteGroupAndTunnels(group: TunnelGroup) = intent {
        groups.deleteWithTunnels(tunnelsUiState.value, group)
    }

    fun moveSelectedToGroup(groupId: Int) = intent {
        groups.moveSelectedToGroup(tunnelsUiState.value, groupId)
    }

    // Releases only the selected tunnels from their groups
    fun ungroupSelected() = intent { selection.ungroupSelected(tunnelsUiState.value) }

    fun exportGroup(group: TunnelGroup, uri: Uri?) = intent {
        export.exportGroup(tunnelsUiState.value, group, uri)
    }

    fun toggleSelectAllTunnels() = intent { selection.toggleSelectAll(tunnelsUiState.value) }

    fun clearSelectedTunnels() = intent { selection.clear() }

    fun toggleSelectedTunnel(tunnelId: Int) = intent {
        selection.toggleTunnel(tunnelsUiState.value, tunnelId)
    }

    fun toggleSelectedGroup(groupId: Int) = intent {
        selection.toggleGroup(tunnelsUiState.value, groupId)
    }

    fun deleteSelectedTunnels() = intent { selection.deleteSelected(tunnelsUiState.value) }

    fun exportSelectedTunnels(uri: Uri?) = intent {
        export.exportSelected(tunnelsUiState.value, uri) { clearSelectedTunnels() }
    }

    fun setScreenRecordingSecurity(to: Boolean) = intent {
        settingsRepository.updateScreenRecordingSecurity(to)
    }
}
