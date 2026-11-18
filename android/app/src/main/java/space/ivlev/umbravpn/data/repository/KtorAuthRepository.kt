package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.data.account.AccountApi
import space.ivlev.umbravpn.data.account.SessionManager
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AuthRepository

class KtorAuthRepository(
    private val api: AccountApi,
    private val sessionManager: SessionManager,
) : AuthRepository {
    override val session: StateFlow<SessionState> = sessionManager.state

    override suspend fun login(
        login: String,
        password: String,
        totpCode: String?,
    ): AccountResult<AuthUser> = api.login(login, password, totpCode)

    override suspend fun register(email: String, password: String): AccountResult<Unit> =
        api.register(email, password)

    override suspend fun verifyEmail(token: String): AccountResult<Unit> = api.verifyEmail(token)

    override suspend fun resendVerification(email: String): AccountResult<Unit> =
        api.resendVerification(email)

    override suspend fun forgotPassword(email: String): AccountResult<Unit> =
        api.forgotPassword(email)

    override suspend fun resetPassword(token: String, password: String): AccountResult<Unit> =
        api.resetPassword(token, password)

    override suspend fun me(): AccountResult<AuthUser> = api.me()

    override suspend fun logout(): AccountResult<Unit> = api.logout()
}
