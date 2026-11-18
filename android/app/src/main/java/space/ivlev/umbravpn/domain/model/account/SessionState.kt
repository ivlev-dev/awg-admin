package space.ivlev.umbravpn.domain.model.account

sealed interface SessionState {
    data object Unknown : SessionState

    data object LoggedOut : SessionState

    data object PendingEmail : SessionState

    data object PendingApproval : SessionState

    data class Blocked(val reason: BlockReason, val email: String? = null) : SessionState

    data class Active(val user: AuthUser) : SessionState

    data object Expired : SessionState
}

sealed interface BlockReason {
    data object Disabled : BlockReason

    data object Rejected : BlockReason
}
