package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.AutoTunnelSettings

interface AutoTunnelSettingsRepository {
    suspend fun upsert(autoTunnelSettings: AutoTunnelSettings)

    val flow: Flow<AutoTunnelSettings>

    suspend fun getAutoTunnelSettings(): AutoTunnelSettings

    suspend fun updateAutoTunnelEnabled(enabled: Boolean)

    suspend fun updateDisableOnCaptivePortal(enabled: Boolean)
}
