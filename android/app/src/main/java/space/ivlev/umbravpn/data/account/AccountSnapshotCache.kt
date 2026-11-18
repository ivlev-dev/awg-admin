package space.ivlev.umbravpn.data.account

import kotlinx.serialization.json.Json
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository

class AccountSnapshotCache(private val settingsRepository: AccountSettingsRepository) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    suspend fun save(snapshot: AccountSnapshot) {
        runCatching { json.encodeToString(AccountSnapshot.serializer(), snapshot) }
            .onSuccess { settingsRepository.setCachedSnapshot(it) }
    }

    suspend fun load(): AccountSnapshot? =
        settingsRepository.cachedSnapshot()?.let {
            runCatching { json.decodeFromString(AccountSnapshot.serializer(), it) }.getOrNull()
        }

    suspend fun clear() {
        settingsRepository.setCachedSnapshot(null)
    }
}
