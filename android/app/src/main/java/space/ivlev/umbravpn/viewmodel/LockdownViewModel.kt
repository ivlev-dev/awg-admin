package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import com.dokar.sonner.ToastType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.LockdownSettingsRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.LockdownSettingsUiState
import space.ivlev.umbravpn.util.StringValue

class LockdownViewModel(
    private val lockdownSettingsRepository: LockdownSettingsRepository,
    private val tunnelCoordinator: TunnelCoordinator,
    private val globalEffectRepository: GlobalEffectRepository,
) : OrbitContainerHost<LockdownSettingsUiState, LockdownSettingsUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<LockdownSettingsUiState, Nothing>(
            LockdownSettingsUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            lockdownSettingsRepository.flow.collect {
                reduce {
                    state.copy(
                        lockdownSettings = it,
                        metered = it.metered,
                        dualStack = it.dualStack,
                        bypassLan = it.bypassLan,
                        isLoading = false,
                    )
                }
            }
        }

    fun setLockdownSettings() = intent {
        reduce { state.copy(showSaveModal = false) }

        val updated =
            state.lockdownSettings.copy(
                metered = state.metered,
                dualStack = state.dualStack,
                bypassLan = state.bypassLan,
            )

        lockdownSettingsRepository.upsert(updated)
        withContext(Dispatchers.IO) { tunnelCoordinator.applyLockdownSettings(updated) }

        postSideEffect(GlobalSideEffect.PopBackStack)
        postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.config_changes_saved),
                ToastType.Success,
            ),
        )
    }

    suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }

    fun setShowSaveModal(to: Boolean) = intent { reduce { state.copy(showSaveModal = to) } }

    fun setMetered(value: Boolean) = intent { reduce { state.copy(metered = value) } }

    fun setDualStack(value: Boolean) = intent { reduce { state.copy(dualStack = value) } }

    fun setBypassLan(value: Boolean) = intent { reduce { state.copy(bypassLan = value) } }
}
