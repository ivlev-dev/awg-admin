package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.GeneralSettings
import space.ivlev.umbravpn.ui.theme.Theme

interface GeneralSettingRepository {
    suspend fun upsert(generalSettings: GeneralSettings)

    val flow: Flow<GeneralSettings>

    suspend fun getGeneralSettings(): GeneralSettings

    suspend fun updateTheme(theme: Theme)

    suspend fun updateLocale(locale: String)

    suspend fun updatePinLockEnabled(enabled: Boolean)

    suspend fun updateAppMode(tunnelMode: TunnelMode)

    suspend fun updateGlobalAmneziaEnabled(enabled: Boolean)

    suspend fun updateScreenRecordingSecurity(enabled: Boolean)

    suspend fun updateSeamlessRecovery(enabled: Boolean)

    suspend fun updateSeamlessRecoveryBounceDelay(seconds: Int)
}
