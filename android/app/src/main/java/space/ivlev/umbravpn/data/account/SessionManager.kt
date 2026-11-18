package space.ivlev.umbravpn.data.account

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.StoredSession
import space.ivlev.umbravpn.domain.security.TokenStore

class SessionManager(private val tokenStore: TokenStore) {
    private val _state =
        MutableStateFlow<SessionState>(
            if (currentSession() != null) SessionState.Unknown else SessionState.LoggedOut,
        )

    val state: StateFlow<SessionState> = _state.asStateFlow()

    fun currentSession(): StoredSession? = runCatching { tokenStore.load() }.getOrNull()

    fun onAuthenticated(session: StoredSession, user: AuthUser) {
        runCatching { tokenStore.save(session) }
        _state.value = SessionState.Active(user)
    }

    fun onUserUpdated(user: AuthUser) {
        _state.value = SessionState.Active(user)
    }

    fun markPendingEmail() {
        clearTokens()
        _state.value = SessionState.PendingEmail
    }

    fun markPendingApproval() {
        clearTokens()
        _state.value = SessionState.PendingApproval
    }

    fun markExpired() {
        clearTokens()
        _state.value = SessionState.Expired
    }

    fun markLoggedOut() {
        clearTokens()
        _state.value = SessionState.LoggedOut
    }

    fun markUnknown() {
        _state.value = SessionState.Unknown
    }

    private fun clearTokens() {
        runCatching { tokenStore.clear() }
    }
}
