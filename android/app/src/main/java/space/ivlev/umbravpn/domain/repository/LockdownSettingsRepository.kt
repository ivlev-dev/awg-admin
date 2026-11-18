package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.domain.model.LockdownSettings

interface LockdownSettingsRepository {
    suspend fun upsert(lockdownSettings: LockdownSettings)

    val flow: Flow<LockdownSettings>

    suspend fun getLockdownSettings(): LockdownSettings
}
