package space.ivlev.umbravpn.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import timber.log.Timber

class DatabaseMaintenance(
    private val database: AppDatabase,
    private val dispatcher: CoroutineDispatcher,
) {
    suspend fun checkpoint() {
        withContext(dispatcher) {
            try {
                database.openHelper.writableDatabase.execSQL(WAL_CHECKPOINT_TRUNCATE)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.w(e, "WAL checkpoint failed")
            }
        }
    }

    companion object {
        const val JOURNAL_SIZE_LIMIT_BYTES = 4L * 1024L * 1024L
        const val WAL_AUTOCHECKPOINT_PAGES = 1000
        const val WAL_CHECKPOINT_TRUNCATE = "PRAGMA wal_checkpoint(TRUNCATE)"
    }
}
