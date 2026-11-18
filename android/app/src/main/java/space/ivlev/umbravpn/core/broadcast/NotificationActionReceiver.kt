package space.ivlev.umbravpn.core.broadcast

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.get
import org.koin.core.component.inject
import org.koin.core.qualifier.named
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.orchestration.NotificationActionCoordinator
import space.ivlev.umbravpn.di.Scope
import timber.log.Timber

class NotificationActionReceiver : BroadcastReceiver(), KoinComponent {

    private val notificationActionCoordinator: NotificationActionCoordinator by inject()

    private val appLockManager: AppLockManager by inject()

    private val applicationScope: CoroutineScope = get(named(Scope.APPLICATION))

    override fun onReceive(context: Context, intent: Intent) {

        applicationScope.launch {
            // With app lock on, actions go through PinGateActivity
            if (appLockManager.isLockRequired()) {
                Timber.w("Ignoring notification action ${intent.action}, app is locked")
                return@launch
            }
            notificationActionCoordinator.handle(intent)
        }
    }
}
