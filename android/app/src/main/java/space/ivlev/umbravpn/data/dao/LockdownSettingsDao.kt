package space.ivlev.umbravpn.data.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import space.ivlev.umbravpn.data.entity.LockdownSettings

@Dao
interface LockdownSettingsDao {
    @Query("SELECT * FROM lockdown_settings LIMIT 1")
    suspend fun getLockdownSettings(): LockdownSettings?

    @Upsert suspend fun upsert(lockdownSettings: LockdownSettings)

    @Query("SELECT * FROM lockdown_settings LIMIT 1")
    fun getLockdownSettingsFlow(): Flow<LockdownSettings?>
}
