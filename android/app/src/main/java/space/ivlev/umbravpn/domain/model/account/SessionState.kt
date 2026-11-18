package space.ivlev.umbravpn.domain.model.account

sealed interface SessionState {
    data object Unknown : SessionState

    data object LoggedOut : SessionState

    data object PendingEmail : SessionState

    data object PendingApproval : SessionState

    data class Active(val user: AuthUser) : SessionState

    data object Expired : SessionState
}
