package space.ivlev.umbravpn.domain.account

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup

class AccountAccessCleanup(
    private val tunnelCleanup: ManagedTunnelCleanup,
    private val resetAutoConnect: () -> Unit,
    private val settingsRepository: AccountSettingsRepository,
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
            resetAutoConnect()
            tunnelCleanup.clear()
            settingsRepository.setManagedProvisioned(false)
        }
    }
}
