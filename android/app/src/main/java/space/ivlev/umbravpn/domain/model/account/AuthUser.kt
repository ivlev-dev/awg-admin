@file:UseSerializers(InstantIsoSerializer::class)

package space.ivlev.umbravpn.domain.model.account

import androidx.compose.runtime.Immutable
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

@Serializable
@Immutable
data class AuthUser(
    val id: String,
    val login: String,
    val email: String,
    val status: UserStatus,
    val totpEnabled: Boolean,
    val role: UserRole,
    val tariffId: String? = null,
    val groupId: String? = null,
    val nodeId: String? = null,
    val disabled: Boolean = false,
    val createdAt: Instant? = null,
    val updatedAt: Instant? = null,
)

@Serializable
enum class UserStatus {
    PendingEmail,
    PendingApproval,
    Active,
    Rejected,
    Unknown;

    companion object {
        fun fromApi(value: String): UserStatus =
            when (value.lowercase()) {
                "pending_email" -> PendingEmail
                "pending_approval" -> PendingApproval
                "active" -> Active
                "rejected" -> Rejected
                else -> Unknown
            }
    }
}

@Serializable
enum class UserRole {
    Admin,
    User,
    Unknown;

    companion object {
        fun fromApi(value: String): UserRole =
            when (value.lowercase()) {
                "admin" -> Admin
                "user" -> User
                else -> Unknown
            }
    }
}
