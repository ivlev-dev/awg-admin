package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.data.network.ServerProbe
import space.ivlev.umbravpn.domain.account.AccountMessages
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.ui.state.OnboardingUiState
import space.ivlev.umbravpn.util.network.ServerUrlValidation
import space.ivlev.umbravpn.util.network.validateServerUrl

sealed interface OnboardingSideEffect {
    data object OpenLogin : OnboardingSideEffect
}

class OnboardingViewModel(
    private val settingsRepository: AccountSettingsRepository,
    private val serverProbe: ServerProbe,
    private val logoutCoordinator: LogoutCoordinator,
) : OrbitContainerHost<OnboardingUiState, OnboardingUiState, OnboardingSideEffect>, ViewModel() {

    override val container =
        orbitContainer<OnboardingUiState, OnboardingSideEffect>(OnboardingUiState()) {
            intent {
                val url = settingsRepository.serverUrl()
                reduce { state.copy(serverUrl = url) }
            }
        }

    fun onServerUrlChange(value: String) = intent {
        reduce { state.copy(serverUrl = value, error = null, probeResult = null) }
    }

    fun save() = intent {
        val validation =
            validateServerUrl(
                state.serverUrl,
                allowHttp = BuildConfig.ALLOW_HTTP_SERVER_URL,
            )
        if (validation is ServerUrlValidation.Invalid) {
            reduce {
                state.copy(error = AccountMessages.ofServerUrl(validation.error), isSaving = false)
            }
            return@intent
        }
        validation as ServerUrlValidation.Valid

        reduce { state.copy(isSaving = true, error = null) }
        logoutCoordinator.logout()
        settingsRepository.setServerUrl(validation.url)
        reduce { state.copy(isSaving = false) }
        postSideEffect(OnboardingSideEffect.OpenLogin)
    }

    fun checkConnection() = intent {
        val validation =
            validateServerUrl(
                state.serverUrl,
                allowHttp = BuildConfig.ALLOW_HTTP_SERVER_URL,
            )
        if (validation is ServerUrlValidation.Invalid) {
            reduce {
                state.copy(
                    error = AccountMessages.ofServerUrl(validation.error),
                    isChecking = false,
                )
            }
            return@intent
        }
        validation as ServerUrlValidation.Valid

        reduce { state.copy(isChecking = true, probeResult = null) }
        val result = serverProbe.check(validation.url)
        reduce { state.copy(isChecking = false, probeResult = result) }
    }

    fun clearProbeResult() = intent { reduce { state.copy(probeResult = null) } }
}
