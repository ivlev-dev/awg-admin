package space.ivlev.umbravpn.domain.model.account

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochSeconds: Long,
    val userId: String?,
    val email: String?,
) {
    fun isExpired(nowEpochSeconds: Long): Boolean = expiresAtEpochSeconds <= nowEpochSeconds
}
