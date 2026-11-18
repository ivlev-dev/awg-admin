package space.ivlev.umbravpn.core.orchestration

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncResult
import timber.log.Timber

class ManagedTunnelSyncStarter(
    private val session: StateFlow<SessionState>,
    private val syncService: ManagedTunnelSyncService,
    private val autoConnector: ManagedTunnelAutoConnector,
    private val scope: CoroutineScope,
    private val dispatcher: CoroutineDispatcher,
) {
    private val started = AtomicBoolean(false)

    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch(dispatcher) {
            session
                .map { it is SessionState.Active }
                .distinctUntilChanged()
                .collect { active ->
                    if (!active) {
                        autoConnector.reset()
                        return@collect
                    }
                    triggerSync()
                }
        }
    }

    private suspend fun triggerSync() {
        try {
            val result = syncService.sync()
            Timber.i("Managed tunnel sync after login: $result")
            if (result is SyncResult.Success) {
                autoConnector.ensureConnected()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "Managed tunnel sync after login failed")
        }
    }
}
