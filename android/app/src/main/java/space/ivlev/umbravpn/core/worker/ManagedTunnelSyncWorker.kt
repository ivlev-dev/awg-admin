package space.ivlev.umbravpn.core.worker

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncResult
import timber.log.Timber

class ManagedTunnelSyncWorker(
    context: Context,
    params: WorkerParameters,
    private val syncService: ManagedTunnelSyncService,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result =
        when (val result = syncService.sync()) {
            is SyncResult.Success -> {
                Timber.i("ManagedTunnelSyncWorker: $result")
                Result.success()
            }

            SyncResult.NotConfigured -> Result.success()

            SyncResult.SessionExpired -> Result.success()

            SyncResult.Offline -> Result.retry()

            is SyncResult.Failed -> {
                Timber.w("ManagedTunnelSyncWorker: sync failed: ${result.message}")
                Result.retry()
            }
        }

    companion object {
        private const val PERIODIC_TAG = "managed_tunnel_sync"
        private const val ONE_TIME_TAG = "managed_tunnel_sync_now"
        private const val SYNC_INTERVAL_HOURS = 6L

        fun start(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<ManagedTunnelSyncWorker>(
                        repeatInterval = SYNC_INTERVAL_HOURS,
                        repeatIntervalTimeUnit = TimeUnit.HOURS,
                    )
                    .setConstraints(networkConstraints())
                    .addTag(PERIODIC_TAG)
                    .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_TAG, ExistingPeriodicWorkPolicy.UPDATE, request)
            Timber.i("ManagedTunnelSyncWorker scheduled every $SYNC_INTERVAL_HOURS hours")
        }

        fun syncNow(context: Context) {
            val request =
                OneTimeWorkRequestBuilder<ManagedTunnelSyncWorker>()
                    .setConstraints(networkConstraints())
                    .addTag(ONE_TIME_TAG)
                    .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONE_TIME_TAG, ExistingWorkPolicy.REPLACE, request)
        }

        fun stop(context: Context) {
            WorkManager.getInstance(context).apply {
                cancelUniqueWork(PERIODIC_TAG)
                cancelUniqueWork(ONE_TIME_TAG)
            }
        }

        private fun networkConstraints(): Constraints =
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    }
}
