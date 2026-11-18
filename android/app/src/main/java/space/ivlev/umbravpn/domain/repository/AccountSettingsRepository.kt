package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow

interface AccountSettingsRepository {
    val serverUrlFlow: Flow<String>

    val termsAcceptedFlow: Flow<Boolean>

    suspend fun serverUrl(): String

    suspend fun setServerUrl(url: String)

    suspend fun termsAccepted(): Boolean

    suspend fun setTermsAccepted(accepted: Boolean)

    suspend fun managedProvisioned(): Boolean = false

    suspend fun setManagedProvisioned(provisioned: Boolean) = Unit
}
