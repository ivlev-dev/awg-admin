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

    override val autoConnectOnStartupFlow: Flow<Boolean> =
        dataStoreManager.getFromStoreFlow(DataStoreManager.accountAutoConnectOnStartup).map {
            it ?: true
        }

    override val termsAcceptedFlow: Flow<Boolean> =
        dataStoreManager.getFromStoreFlow(DataStoreManager.accountTermsAccepted).map { it ?: false }

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

    override suspend fun managedProvisioned(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountManagedProvisioned) ?: false

    override suspend fun setManagedProvisioned(provisioned: Boolean) {
        dataStoreManager.saveToDataStore(
            DataStoreManager.accountManagedProvisioned,
            provisioned,
        )
    }

    override suspend fun cachedSnapshot(): String? =
        dataStoreManager.getFromStore(DataStoreManager.accountSnapshotCache)

    override suspend fun setCachedSnapshot(json: String?) {
        if (json == null) {
            dataStoreManager.removeFromDataStore(DataStoreManager.accountSnapshotCache)
        } else {
            dataStoreManager.saveToDataStore(DataStoreManager.accountSnapshotCache, json)
        }
    }

    override suspend fun manualDisconnect(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountManualDisconnect) ?: false

    override suspend fun setManualDisconnect(value: Boolean) {
        dataStoreManager.saveToDataStore(DataStoreManager.accountManualDisconnect, value)
    }

    override suspend fun autoConnectOnStartup(): Boolean =
        dataStoreManager.getFromStore(DataStoreManager.accountAutoConnectOnStartup) ?: true

    override suspend fun setAutoConnectOnStartup(enabled: Boolean) {
        dataStoreManager.saveToDataStore(DataStoreManager.accountAutoConnectOnStartup, enabled)
    }
}
