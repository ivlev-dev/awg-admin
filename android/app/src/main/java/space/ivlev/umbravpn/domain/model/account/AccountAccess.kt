package space.ivlev.umbravpn.domain.model.account

import java.time.Instant

data class AccountSubscription(
    val id: String = "",
    val planName: String = "",
    val status: SubscriptionStatus = SubscriptionStatus.Unknown,
    val currentPeriodEnd: Instant? = null,
    val autoRenew: Boolean = false,
    val cancelAtPeriodEnd: Boolean = false,
    val grantsAccess: Boolean = false,
) {
    val isActive: Boolean
        get() = status == SubscriptionStatus.Active || status == SubscriptionStatus.Trialing
}

enum class SubscriptionStatus {
    Active,
    Trialing,
    PastDue,
    Suspended,
    Canceled,
    Unknown;

    companion object {
        fun fromApi(value: String): SubscriptionStatus =
            when (value.lowercase()) {
                "active" -> Active
                "trialing" -> Trialing
                "past_due" -> PastDue
                "suspended" -> Suspended
                "canceled",
                "cancelled" -> Canceled
                else -> Unknown
            }
    }
}

data class AccountAccess(
    val blocked: Boolean = false,
    val throttled: Boolean = false,
    val reasons: Set<AccountAccessReason> = emptySet(),
) {
    val quotaExceeded: Boolean
        get() = AccountAccessReason.QuotaExceeded in reasons

    val subscriptionInactive: Boolean
        get() = AccountAccessReason.SubscriptionInactive in reasons

    val tariffMissing: Boolean
        get() = AccountAccessReason.TariffMissing in reasons
}

enum class AccountAccessReason {
    QuotaExceeded,
    SubscriptionInactive,
    TariffMissing,
    Unknown;

    companion object {
        fun fromApi(value: String): AccountAccessReason =
            when (value.lowercase()) {
                "quota_exceeded" -> QuotaExceeded
                "subscription_inactive" -> SubscriptionInactive
                "tariff_missing" -> TariffMissing
                else -> Unknown
            }
    }
}
