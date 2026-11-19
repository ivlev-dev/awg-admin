package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.SessionState

interface AuthRepository {
    val session: StateFlow<SessionState>

    suspend fun login(
        email: String,
        password: String,
        totpCode: String? = null,
    ): AccountResult<AuthUser>

    suspend fun register(
        email: String,
        password: String,
        fullName: String? = null,
    ): AccountResult<Unit>

    suspend fun verifyEmail(token: String): AccountResult<Unit>

    suspend fun resendVerification(email: String): AccountResult<Unit>

    suspend fun forgotPassword(email: String): AccountResult<Unit>

    suspend fun resetPassword(token: String, password: String): AccountResult<Unit>

    suspend fun me(): AccountResult<AuthUser>

    suspend fun logout(): AccountResult<Unit>
}
