package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup

/**
 * The single sign-out path. It stops running tunnels, removes managed tunnel bindings and the
 * provisioned flag, and only then clears stored tokens. Used by account screens, email verification
 * and the session expired/blocked flow so no path leaves keys or tunnels behind.
 */
class LogoutCoordinator(
    private val stopTunnels: suspend () -> Unit,
    private val tunnelCleanup: ManagedTunnelCleanup,
    private val resetAutoConnect: () -> Unit,
    private val settingsRepository: AccountSettingsRepository,
    private val authActions: AuthActions,
) {
    suspend fun logout(): ActionResult<Unit> {
        clearLocalAccess()
        settingsRepository.setCachedSnapshot(null)
        return authActions.logout()
    }

    suspend fun clearLocalAccess() {
        runCatching { stopTunnels() }
        resetAutoConnect()
        tunnelCleanup.clear()
        settingsRepository.setManagedProvisioned(false)
    }
}
