package space.ivlev.umbravpn.core.broadcast

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.zaneschepke.logcatter.LogReader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.get
import org.koin.core.component.inject
import org.koin.core.qualifier.named
import space.ivlev.umbravpn.core.orchestration.StartupCoordinator
import space.ivlev.umbravpn.di.Scope
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import timber.log.Timber

class RestartReceiver : BroadcastReceiver(), KoinComponent {

    private val applicationScope: CoroutineScope = get(named(Scope.APPLICATION))

    private val startupCoordinator: StartupCoordinator by inject()

    private val appStateRepository: AppStateRepository by inject()

    private val logReader: LogReader by inject()

    override fun onReceive(context: Context, intent: Intent) {
        Timber.d("RestartReceiver triggered with action: ${intent.action}")

        val pendingResult = goAsync()

        applicationScope.launch {
            try {
                when (intent.action) {
                    Intent.ACTION_BOOT_COMPLETED,
                    "android.intent.action.QUICKBOOT_POWERON",
                    "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                        startupCoordinator.applyStartupPolicy()
                    }

                    Intent.ACTION_MY_PACKAGE_REPLACED -> {
                        Timber.i("Restoring runtime state on package upgrade")
                        startupCoordinator.restoreAfterPackageReplace()
                        logReader.deleteAndClearLogs()
                        appStateRepository.setShouldShowDonationSnackbar(true)
                    }

                    else -> {
                        Timber.w("Unhandled action in RestartReceiver: ${intent.action}")
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
