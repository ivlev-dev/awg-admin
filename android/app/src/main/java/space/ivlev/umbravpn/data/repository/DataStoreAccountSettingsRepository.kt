package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.DataStoreManager
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.util.network.normalizeServerUrl

class DataStoreAccountSettingsRepository(
    private val dataStoreManager: DataStoreManager,
) : AccountSettingsRepository {
    override val serverUrlFlow: Flow<String> =
        dataStoreManager.getFromStoreFlow(DataStoreManager.accountServerUrl).map {
            normalizeServerUrl(it.orEmpty())
        }

    override val termsAcceptedFlow: Flow<Boolean> =
        dataStoreManager.getFromStoreFlow(DataStoreManager.accountTermsAccepted).map { it ?: false }

    override val onboardingDismissedFlow: Flow<Boolean> =
        dataStoreManager.getFromStoreFlow(DataStoreManager.accountOnboardingDismissed).map {
            it ?: false
        }

    override suspend fun serverUrl(): String =
        normalizeServerUrl(
            dataStoreManager.getFromStore(DataStoreManager.accountServerUrl).orEmpty(),
        )

    override suspend fun setServerUrl(url: String) {
        dataStoreManager.saveToDataStore(
            DataStoreManager.accountServerUrl,
            normalizeServerUrl(url),
        )
    }

    override suspend fun termsAccepted(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountTermsAccepted) ?: false

    override suspend fun setTermsAccepted(accepted: Boolean) {
        dataStoreManager.saveToDataStore(DataStoreManager.accountTermsAccepted, accepted)
    }

    override suspend fun onboardingDismissed(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountOnboardingDismissed) ?: false

    override suspend fun setOnboardingDismissed(dismissed: Boolean) {
        dataStoreManager.saveToDataStore(DataStoreManager.accountOnboardingDismissed, dismissed)
    }

    override suspend fun managedProvisioned(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountManagedProvisioned) ?: false

    override suspend fun setManagedProvisioned(provisioned: Boolean) {
        dataStoreManager.saveToDataStore(
            DataStoreManager.accountManagedProvisioned,
            provisioned,
        )
    }
}
