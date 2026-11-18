package space.ivlev.umbravpn.core.shortcut

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject
import org.koin.core.qualifier.named
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.lock.PinGateActivity
import space.ivlev.umbravpn.core.orchestration.ShortcutCoordinator
import space.ivlev.umbravpn.di.Scope

class ShortcutsActivity : ComponentActivity() {

    private val shortcutCoordinator: ShortcutCoordinator by inject()

    private val appLockManager: AppLockManager by inject()

    private val applicationScope: CoroutineScope by inject(named(Scope.APPLICATION))

    override fun onCreate(savedInstanceState: Bundle?) {

        super.onCreate(savedInstanceState)

        // Stays open while the lock setting is read, so the PIN screen can still be started
        lifecycleScope.launch {
            if (appLockManager.isLockRequired()) {
                startActivity(
                    PinGateActivity.intent(
                        this@ShortcutsActivity,
                        PinGateActivity.Action.SHORTCUT,
                        forwarded = intent,
                    ),
                )
            } else {
                val shortcut = intent
                applicationScope.launch { shortcutCoordinator.handle(shortcut) }
            }
            finish()
        }
    }
}
