package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

interface AccountSettingsRepository {
    val serverUrlFlow: Flow<String>

    val termsAcceptedFlow: Flow<Boolean>

    val autoConnectOnStartupFlow: Flow<Boolean>
        get() = flowOf(true)

    suspend fun serverUrl(): String

    suspend fun setServerUrl(url: String)

    suspend fun termsAccepted(): Boolean

    suspend fun setTermsAccepted(accepted: Boolean)

    suspend fun managedProvisioned(): Boolean = false

    suspend fun setManagedProvisioned(provisioned: Boolean) = Unit

    suspend fun cachedSnapshot(): String? = null

    suspend fun setCachedSnapshot(json: String?) = Unit

    suspend fun manualDisconnect(): Boolean = false

    suspend fun setManualDisconnect(value: Boolean) = Unit

    suspend fun autoConnectOnStartup(): Boolean = true

    suspend fun setAutoConnectOnStartup(enabled: Boolean) = Unit
}
