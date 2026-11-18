package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import com.dokar.sonner.ToastType
import com.wgtunnel.parser.ConfigParseException
import kotlinx.coroutines.flow.combine
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.enums.MimicMode
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.EditableConfig
import space.ivlev.umbravpn.ui.state.EditableInterface
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.extensions.asStringValue

data class GlobalAmneziaUiState(
    val isLoading: Boolean = true,
    val tunnelId: Int? = null,
    val interfaceDraft: EditableInterface = EditableInterface(),
    val enabled: Boolean = false,
    val tunnelActive: Boolean = false,
    val savedInterfaceDraft: EditableInterface = EditableInterface(),
) {
    val isDirty: Boolean
        get() = !isLoading && interfaceDraft != savedInterfaceDraft
}

class GlobalAmneziaViewModel(
    private val tunnelRepository: TunnelRepository,
    private val settingsRepository: GeneralSettingRepository,
    private val globalEffectRepository: GlobalEffectRepository,
    private val tunnelCoordinator: TunnelCoordinator,
) : OrbitContainerHost<GlobalAmneziaUiState, GlobalAmneziaUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<GlobalAmneziaUiState, Nothing>(
            GlobalAmneziaUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            combine(
                    tunnelRepository.globalTunnelFlow,
                    settingsRepository.flow,
                    tunnelCoordinator.backendStatus,
                ) { globalTunnel, settings, backendStatus ->
                    Triple(globalTunnel, settings.isGlobalAmneziaEnabled, backendStatus)
                }
                .collect { (globalTunnel, enabled, backendStatus) ->
                    intent {
                        val active = backendStatus.activeTunnels.isNotEmpty()
                        // Room can emit null before the bootstrap global config exists.
                        // Seed once that row is available, and never overwrite a draft the user is
                        // editing.
                        val needsDraft =
                            state.isLoading || (state.tunnelId == null && globalTunnel != null)
                        if (needsDraft) {
                            val draft =
                                globalTunnel?.let {
                                    EditableInterface.from(it.getConfig().`interface`)
                                } ?: EditableInterface()
                            reduce {
                                state.copy(
                                    isLoading = false,
                                    tunnelId = globalTunnel?.id,
                                    interfaceDraft = draft,
                                    enabled = enabled,
                                    tunnelActive = active,
                                    savedInterfaceDraft = draft,
                                )
                            }
                        } else {
                            reduce { state.copy(enabled = enabled, tunnelActive = active) }
                        }
                    }
                }
        }

    fun onInterfaceChange(editableInterface: EditableInterface) = intent {
        reduce { state.copy(interfaceDraft = editableInterface) }
    }

    fun onMimic(mimic: MimicMode) = intent {
        val updated =
            when (mimic) {
                MimicMode.QUIC -> state.interfaceDraft.setQuicMimic()
                MimicMode.DNS -> state.interfaceDraft.setDnsMimic()
                MimicMode.SIP -> state.interfaceDraft.setSipMimic()
            }
        reduce { state.copy(interfaceDraft = updated) }
    }

    fun toggleAmneziaCompat() = intent {
        val updated =
            if (state.interfaceDraft.isAmneziaCompatibilityModeSet()) {
                state.interfaceDraft.resetAmneziaProperties()
            } else {
                state.interfaceDraft.applyAmneziaDefaults()
            }
        reduce { state.copy(interfaceDraft = updated) }
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
        val stored = state.tunnelId?.let { tunnelRepository.getById(it) } ?: return@intent
        val merged =
            EditableConfig.from(stored.getConfig()).let {
                it.copy(`interface` = it.`interface`.withAmneziaFrom(state.interfaceDraft))
            }
        val config =
            try {
                merged.validatedConfig(stored.name)
            } catch (e: ConfigParseException) {
                postSideEffect(GlobalSideEffect.Snackbar(e.asStringValue(), ToastType.Error))
                return@intent
            }
        tunnelRepository.save(
            stored.copy(quickConfig = config.withName(stored.name).asQuickString()),
        )
        reduce { state.copy(savedInterfaceDraft = state.interfaceDraft) }
        if (restart) tunnelCoordinator.restartActiveTunnels()
        postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.config_changes_saved),
                ToastType.Success,
            ),
        )
        postSideEffect(GlobalSideEffect.PopBackStack)
    }

    private suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }
}
