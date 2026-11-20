package space.ivlev.umbravpn.viewmodel

import androidx.lifecycle.ViewModel
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.syntax.Syntax
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.domain.admin.AdminMessages
import space.ivlev.umbravpn.domain.admin.AdminSettingsValidation
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.admin.toPanelSettings
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminBrowserProfile
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationIntensity
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationProfile
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsDraft
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsNumberField
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.ui.state.AdminSettingsUiState

class AdminSettingsViewModel(
    private val repository: AdminRepository,
    authRepository: AuthRepository,
) : OrbitContainerHost<AdminSettingsUiState, AdminSettingsUiState, Nothing>, ViewModel() {

    override val container =
        orbitContainer<AdminSettingsUiState, Nothing>(AdminSettingsUiState()) {
            intent {
                if (!authRepository.session.value.isAdminSession()) {
                    reduce { state.copy(accessDenied = true) }
                    return@intent
                }
                load()
            }
        }

    fun retry() = intent {
        reduce { state.copy(error = null) }
        load()
    }

    fun onProfileChange(profile: AdminObfuscationProfile) = intent {
        edit { copy(profile = profile) }
    }

    fun onIntensityChange(intensity: AdminObfuscationIntensity) = intent {
        edit { copy(intensity = intensity) }
    }

    fun onBrowserChange(browser: AdminBrowserProfile) = intent { edit { copy(browser = browser) } }

    fun onNumberChange(field: AdminSettingsNumberField, value: String) = intent {
        edit {
            when (field) {
                AdminSettingsNumberField.Mtu -> copy(mtu = value)
                AdminSettingsNumberField.JcMin -> copy(jcMin = value)
                AdminSettingsNumberField.JcMax -> copy(jcMax = value)
                AdminSettingsNumberField.JminMin -> copy(jminMin = value)
                AdminSettingsNumberField.JminMax -> copy(jminMax = value)
                AdminSettingsNumberField.JmaxExtraMin -> copy(jmaxExtraMin = value)
                AdminSettingsNumberField.JmaxExtraMax -> copy(jmaxExtraMax = value)
                AdminSettingsNumberField.SMin -> copy(sMin = value)
                AdminSettingsNumberField.SMax -> copy(sMax = value)
                AdminSettingsNumberField.KeepaliveMin -> copy(keepaliveMin = value)
                AdminSettingsNumberField.KeepaliveMax -> copy(keepaliveMax = value)
                AdminSettingsNumberField.ShareTtl -> copy(shareTtl = value)
                AdminSettingsNumberField.RetentionDays -> copy(retentionDays = value)
            }
        }
    }

    fun onHostsChange(value: String) = intent { edit { copy(hosts = value) } }

    fun onRandomTrailersChange(value: Boolean) = intent { edit { copy(randomTrailers = value) } }

    fun onDisableCookiesChange(value: Boolean) = intent { edit { copy(disableCookies = value) } }

    fun discard() = intent {
        val saved = state.savedDraft ?: return@intent
        if (state.isSaving) return@intent
        reduce { state.copy(draft = saved).clearErrors() }
    }

    fun save() = intent {
        if (state.isSaving || !state.isDirty) return@intent
        val validation = AdminSettingsValidation.validate(state.draft)
        reduce {
            state.copy(
                mtuError = validation.mtu,
                jcError = validation.jc,
                jminError = validation.jmin,
                jmaxError = validation.jmax,
                sError = validation.s,
                keepaliveError = validation.keepalive,
                hostsError = validation.hosts,
                shareTtlError = validation.shareTtl,
                retentionError = validation.retention,
                isSaved = false,
            )
        }
        if (!validation.isValid) return@intent
        val settings = state.draft.toPanelSettings() ?: return@intent
        reduce { state.copy(isSaving = true, error = null) }
        when (val result = repository.updateSettings(settings)) {
            is AccountResult.Success -> {
                val saved = AdminSettingsDraft.from(result.value)
                reduce {
                    state
                        .copy(
                            initial = result.value,
                            savedDraft = saved,
                            draft = saved,
                            isSaving = false,
                            isSaved = true,
                            error = null,
                        )
                        .clearErrors()
                }
            }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isSaving = false,
                        isSaved = false,
                        error = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminSettingsUiState, Nothing>.load() {
        reduce { state.copy(isLoading = true, error = null) }
        when (val result = repository.settings()) {
            is AccountResult.Success -> {
                val draft = AdminSettingsDraft.from(result.value)
                reduce {
                    state
                        .copy(
                            initial = result.value,
                            savedDraft = draft,
                            draft = draft,
                            isLoading = false,
                            isLoaded = true,
                            isSaved = false,
                            error = null,
                        )
                        .clearErrors()
                }
            }
            is AccountResult.Failure ->
                reduce {
                    state.copy(
                        isLoading = false,
                        isLoaded = true,
                        error = AdminMessages.of(result.error),
                    )
                }
        }
    }

    private suspend fun Syntax<AdminSettingsUiState, Nothing>.edit(
        transform: AdminSettingsDraft.() -> AdminSettingsDraft,
    ) {
        if (state.isSaving) return
        reduce { state.copy(draft = state.draft.transform(), isSaved = false).clearErrors() }
    }

    private fun AdminSettingsUiState.clearErrors(): AdminSettingsUiState =
        copy(
            mtuError = null,
            jcError = null,
            jminError = null,
            jmaxError = null,
            sError = null,
            keepaliveError = null,
            hostsError = null,
            shareTtlError = null,
            retentionError = null,
        )
}
