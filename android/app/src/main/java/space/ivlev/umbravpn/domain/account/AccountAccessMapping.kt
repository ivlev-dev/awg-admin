package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.BlockReason

internal const val API_CODE_ACCOUNT_DISABLED = "account_disabled"
internal const val API_CODE_REJECTED = "rejected"
internal const val API_CODE_TARIFF_REQUIRED = "tariff_required"
internal const val API_CODE_SUBSCRIPTION_INACTIVE = "subscription_inactive"

fun AccountError.blockReason(): BlockReason? =
    when (this) {
        is AccountError.Disabled -> reason
        is AccountError.Api ->
            when (code) {
                API_CODE_ACCOUNT_DISABLED -> BlockReason.Disabled
                API_CODE_REJECTED -> BlockReason.Rejected
                else -> null
            }
        else -> null
    }
