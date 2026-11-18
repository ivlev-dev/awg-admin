package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import com.dokar.sonner.ToastType
import com.wgtunnel.backend.shell.ShellExecutor
import java.util.UUID
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.core.shortcut.ShortcutManager
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.MonitoringSettingsRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.SettingUiState
import space.ivlev.umbravpn.util.StringValue

class SettingsViewModel(
    private val settingsRepository: GeneralSettingRepository,
    private val shortcutManager: ShortcutManager,
    private val tunnelsRepository: TunnelRepository,
    private val monitoringRepository: MonitoringSettingsRepository,
    private val globalEffectRepository: GlobalEffectRepository,
    private val tunnelCoordinator: TunnelCoordinator,
    private val appStateRepository: AppStateRepository,
) : OrbitContainerHost<SettingUiState, SettingUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<SettingUiState, Nothing>(
            SettingUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            intent {
                combine(
                        settingsRepository.flow,
                        tunnelsRepository.globalTunnelFlow,
                        tunnelsRepository.userTunnelsFlow,
                        monitoringRepository.flow,
                        tunnelCoordinator.backendStatus
                            .map { status ->
                                val active = status.activeTunnels.values
                                Triple(
                                    active.isNotEmpty(),
                                    active.sumOf { it.recoveryAttempts },
                                    active.maxOfOrNull { it.lastRecoveryAttemptMs } ?: 0L,
                                )
                            }
                            .distinctUntilChanged(),
                    ) { settings, tunnel, tunnels, monitoring, recovery ->
                        val (tunnelActive, recoveryEventCount, lastRecoveryEventMs) = recovery
                        state.copy(
                            settings = settings,
                            remoteKey = settings.remoteKey,
                            isRemoteEnabled = settings.isRemoteControlEnabled,
                            isPinLockEnabled = settings.isPinLockEnabled,
                            isLoading = false,
                            tunnelActive = tunnelActive,
                            globalTunnelConfig = tunnel,
                            monitoring = monitoring,
                            tunnels = tunnels,
                            recoveryEventCount = recoveryEventCount,
                            lastRecoveryEventMs = lastRecoveryEventMs,
                        )
                    }
                    .collect { reduce { it } }
            }
        }

    fun setShortcutsEnabled(to: Boolean) = intent {
        if (to) shortcutManager.addShortcuts() else shortcutManager.removeShortcuts()
        settingsRepository.upsert(state.settings.copy(isShortcutsEnabled = to))
    }

    suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }

    fun setAlwaysOnVpnEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isAlwaysOnVpnEnabled = to))
    }

    fun setLiveUpdatesEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isLiveUpdatesEnabled = to))
    }

    fun setNotificationOriginEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isNotificationOriginEnabled = to))
    }

    fun setNotificationTransferEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isNotificationTransferEnabled = to))
    }

    fun setNotificationRecoveryEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isNotificationRecoveryEnabled = to))
    }

    fun setNotificationFailureTintEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isNotificationFailureTintEnabled = to))
    }

    fun setRestoreOnBootEnabled(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(isRestoreOnBootEnabled = to))
    }

    fun setGlobalSplitTunneling(to: Boolean, restart: Boolean = false) = intent {
        settingsRepository.upsert(state.settings.copy(isGlobalSplitTunnelEnabled = to))
        if (restart) {
            settingsRepository.flow.first { it.isGlobalSplitTunnelEnabled == to }
            tunnelCoordinator.restartActiveTunnels()
        }
    }

    fun setGlobalAmneziaEnabled(to: Boolean) = intent {
        settingsRepository.updateGlobalAmneziaEnabled(to)
    }

    fun setStrictSplitTunnel(to: Boolean, restart: Boolean) = intent {
        appStateRepository.setStrictSplitDecided(true)
        settingsRepository.upsert(state.settings.copy(strictSplitTunnelEnabled = to))
        if (restart) {
            settingsRepository.flow.first { it.strictSplitTunnelEnabled == to }
            tunnelCoordinator.restartActiveTunnels()
        }
    }

    fun setLocalLogging(to: Boolean) = intent {
        monitoringRepository.upsert(state.monitoring.copy(isLocalLogsEnabled = to))
    }

    fun setRemoteEnabled(to: Boolean) = intent {
        val key =
            state.settings.remoteKey?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        settingsRepository.upsert(state.settings.copy(isRemoteControlEnabled = to, remoteKey = key))
    }

    fun rotateRemoteKey() = intent {
        settingsRepository.upsert(state.settings.copy(remoteKey = UUID.randomUUID().toString()))
        postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.remote_key_rotated),
                ToastType.Success,
            ),
        )
    }

    fun setTunnelScriptedEnabled(to: Boolean) = intent {
        if (to) {
            val accepted = ShellExecutor.requestPrivilegedAccess()
            if (!accepted)
                return@intent postSideEffect(
                    GlobalSideEffect.Snackbar(
                        StringValue.StringResource(R.string.error_root_denied),
                        ToastType.Error,
                    ),
                )
            postSideEffect(
                GlobalSideEffect.Snackbar(
                    StringValue.StringResource(R.string.root_accepted),
                    ToastType.Success,
                ),
            )
        }
        settingsRepository.upsert(state.settings.copy(tunnelScriptingEnabled = to))
    }

    fun setSeamlessRecovery(enabled: Boolean) = intent {
        settingsRepository.updateSeamlessRecovery(enabled)
    }

    fun setSeamlessRecoveryBounceDelay(seconds: Int) = intent {
        settingsRepository.updateSeamlessRecoveryBounceDelay(seconds)
    }

    fun setAlreadyDonated(to: Boolean) = intent {
        settingsRepository.upsert(state.settings.copy(alreadyDonated = to))
    }
}
