package space.ivlev.umbravpn.domain.account

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup

/**
 * Cleans local access when the server rejects the session. Tokens are cleared by [SessionManager];
 * this class also stops tunnels so a blocked account does not keep an active connection.
 */
class AccountAccessCleanup(
    private val tunnelCleanup: ManagedTunnelCleanup,
    private val resetAutoConnect: () -> Unit,
    private val settingsRepository: AccountSettingsRepository,
    private val stopTunnels: suspend () -> Unit = {},
    private val mutex: Mutex = Mutex(),
) {
    private var cleanedFor: SessionState? = null

    suspend fun onSessionState(state: SessionState) {
        if (state !is SessionState.Blocked && state != SessionState.Expired) {
            mutex.withLock { cleanedFor = null }
            return
        }
        mutex.withLock {
            if (cleanedFor == state) return
            cleanedFor = state
            runCatching { stopTunnels() }
            resetAutoConnect()
            tunnelCleanup.clear()
            settingsRepository.setManagedProvisioned(false)
        }
    }
}
