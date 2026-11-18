package space.ivlev.umbravpn.viewmodel

import android.os.Build
import androidx.lifecycle.ViewModel
import com.dokar.sonner.ToastType
import com.wgtunnel.backend.state.BackendStatus
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.GeneralSettings
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.InstalledPackageRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.state.SplitBehavior
import space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.state.splitBehaviorOf
import space.ivlev.umbravpn.ui.state.EditableConfig
import space.ivlev.umbravpn.ui.state.EditableInterface
import space.ivlev.umbravpn.ui.state.SplitAppListSummary
import space.ivlev.umbravpn.ui.state.SplitTunnelUiState
import space.ivlev.umbravpn.ui.state.splitAppListSummary
import space.ivlev.umbravpn.util.StringValue

class SplitTunnelViewModel(
    private val tunnelRepository: TunnelRepository,
    private val packageRepository: InstalledPackageRepository,
    private val globalEffectRepository: GlobalEffectRepository,
    private val settingsRepository: GeneralSettingRepository,
    private val tunnelCoordinator: TunnelCoordinator,
    val tunnelId: Int,
) : OrbitContainerHost<SplitTunnelUiState, SplitTunnelUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<SplitTunnelUiState, Nothing>(
            SplitTunnelUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            val packagesFlow = packageRepository.installedPackages

            val tunnelsFlow = tunnelRepository.userTunnelsFlow

            val currentTunnelFlow =
                tunnelRepository.flow.map { list -> list.firstOrNull { it.id == tunnelId } }

            // Seed the app sets once, inside reduce. Later emissions must not replace them.
            combine(
                    combine(packagesFlow, tunnelsFlow, currentTunnelFlow) {
                        packages,
                        tunnels,
                        tunnel ->
                        Triple(packages, tunnels, tunnel)
                    },
                    combine(settingsRepository.flow, tunnelRepository.globalTunnelFlow) {
                        settings,
                        global ->
                        settings to global
                    },
                    tunnelCoordinator.backendStatus,
                ) { lists, settingsAndGlobal, status ->
                    Triple(lists, settingsAndGlobal, status)
                }
                .collect { (lists, settingsAndGlobal, status) ->
                    val (settings, globalTunnel) = settingsAndGlobal
                    reduce {
                        val (packages, tunnels, incoming) = lists
                        val tunnel = incoming ?: state.tunnel
                        val restart = needsRestart(tunnel, settings, status)
                        val override = globalOverrideSummary(tunnel, settings, globalTunnel)
                        val strict =
                            settings.strictSplitTunnelEnabled.takeIf {
                                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                                    settings.tunnelMode == TunnelMode.VPN
                            }
                        if (!state.initialized && incoming != null) {
                            val config = incoming.getConfig()
                            val included = config.`interface`.allIncludedApps.toSet()
                            val excluded = config.`interface`.allExcludedApps.toSet()
                            state.copy(
                                initialized = true,
                                installedPackages = packages,
                                tunnels = tunnels.map { it.toSummary() },
                                tunnel = incoming,
                                isLoading = packages.isEmpty(),
                                activeBehavior = splitBehaviorOf(included, excluded),
                                includedPackages = included,
                                excludedPackages = excluded,
                                savedBehavior = splitBehaviorOf(included, excluded),
                                savedIncludedPackages = included,
                                savedExcludedPackages = excluded,
                                needsRestart = restart,
                                globalOverride = override,
                                strictSplitEnabled = strict,
                            )
                        } else {
                            state.copy(
                                installedPackages = packages,
                                tunnels = tunnels.map { it.toSummary() },
                                tunnel = tunnel,
                                isLoading = packages.isEmpty() || !state.initialized,
                                needsRestart = restart,
                                globalOverride = override,
                                strictSplitEnabled = strict,
                            )
                        }
                    }
                }
        }

    private fun globalOverrideSummary(
        tunnel: TunnelConfig?,
        settings: GeneralSettings,
        global: TunnelConfig?,
    ): SplitAppListSummary? {
        if (tunnel == null || tunnel.isGlobalConfig) return null
        if (!settings.isGlobalSplitTunnelEnabled || global == null) return null
        val iface = global.getConfig().`interface`
        return splitAppListSummary(
            includedCount = iface.allIncludedApps.size,
            excludedCount = iface.allExcludedApps.size,
            emptyMeansAllTunneled = true,
        )
    }

    private fun needsRestart(
        tunnel: TunnelConfig?,
        settings: GeneralSettings,
        status: BackendStatus,
    ): Boolean {
        if (tunnel == null || settings.tunnelMode != TunnelMode.VPN) return false
        val activeIds = status.activeTunnels.keys
        // Only when this save changes the list a running VPN will use.
        return if (tunnel.isGlobalConfig) {
            settings.isGlobalSplitTunnelEnabled && activeIds.isNotEmpty()
        } else {
            !settings.isGlobalSplitTunnelEnabled && tunnel.id in activeIds
        }
    }

    suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }

    fun save(restart: Boolean = false) = intent {
        if (!state.isDirty) {
            postSideEffect(
                GlobalSideEffect.Snackbar(
                    StringValue.StringResource(R.string.save_disabled_no_changes),
                    ToastType.Info,
                ),
            )
            return@intent
        }
        val current = state
        val tunnel = current.tunnel ?: return@intent
        val config = tunnel.getConfig()
        val editableConfig = EditableConfig.from(config)
        val editableInterface = EditableInterface.from(config.`interface`)
        val (included, excluded) =
            when (current.activeBehavior) {
                SplitBehavior.ALL -> emptySet<String>() to emptySet()
                SplitBehavior.INCLUDE -> current.includedPackages to emptySet()
                SplitBehavior.EXCLUDE -> emptySet<String>() to current.excludedPackages
            }
        val updatedInterface =
            editableInterface.copy(
                includedApplications = included,
                excludedApplications = excluded,
            )
        val updatedProxyConfig = editableConfig.copy(`interface` = updatedInterface)
        val updatedConfig = updatedProxyConfig.buildConfig()
        val updatedTunnel =
            tunnel.copy(quickConfig = updatedConfig.withName(tunnel.name).asQuickString())
        tunnelRepository.save(updatedTunnel)
        reduce {
            state.copy(
                savedBehavior = current.activeBehavior,
                savedIncludedPackages = current.includedPackages,
                savedExcludedPackages = current.excludedPackages,
            )
        }
        if (restart) {
            if (updatedTunnel.isGlobalConfig) {
                tunnelCoordinator.restartActiveTunnels()
            } else {
                tunnelCoordinator.stopTunnel(updatedTunnel.id)
                tunnelCoordinator.startTunnel(updatedTunnel)
            }
        }
        postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.config_changes_saved),
                ToastType.Success,
            ),
        )
        postSideEffect(GlobalSideEffect.PopBackStack)
    }

    fun setActiveBehavior(behavior: SplitBehavior) = intent {
        reduce { state.copy(activeBehavior = behavior) }
    }

    fun togglePackage(pkg: String, enabled: Boolean) = intent {
        reduce {
            when (state.activeBehavior) {
                SplitBehavior.ALL -> state
                SplitBehavior.INCLUDE -> {
                    val updated =
                        state.includedPackages.toMutableSet().apply {
                            if (enabled) add(pkg) else remove(pkg)
                        }
                    state.copy(includedPackages = updated)
                }
                SplitBehavior.EXCLUDE -> {
                    val updated =
                        state.excludedPackages.toMutableSet().apply {
                            if (enabled) add(pkg) else remove(pkg)
                        }
                    state.copy(excludedPackages = updated)
                }
            }
        }
    }

    fun applyCopySource() = intent {
        val id = state.selectedCopySourceTunnelId ?: return@intent

        val tunnel = tunnelRepository.getById(id) ?: return@intent

        val config = tunnel.getConfig()
        val included = config.`interface`.allIncludedApps.toSet()
        val excluded = config.`interface`.allExcludedApps.toSet()
        reduce {
            state.copy(
                activeBehavior = splitBehaviorOf(included, excluded),
                includedPackages = included,
                excludedPackages = excluded,
                savedBehavior = splitBehaviorOf(included, excluded),
                savedIncludedPackages = included,
                savedExcludedPackages = excluded,
                selectedCopySourceTunnelId = null,
            )
        }
    }

    fun selectCopySource(tunnelId: Int?) = intent {
        reduce { state.copy(selectedCopySourceTunnelId = tunnelId) }
    }
}
