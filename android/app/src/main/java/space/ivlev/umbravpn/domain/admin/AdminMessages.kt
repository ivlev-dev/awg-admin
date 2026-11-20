package space.ivlev.umbravpn.domain.admin

import space.ivlev.umbravpn.domain.model.account.AccountError

sealed interface AdminMessage {
    data object Network : AdminMessage

    data object SessionExpired : AdminMessage

    data object Forbidden : AdminMessage

    data object NotFound : AdminMessage

    data class Conflict(val detail: String? = null) : AdminMessage

    data object RateLimited : AdminMessage

    data object Server : AdminMessage

    data object Unknown : AdminMessage

    data object EmailRequired : AdminMessage

    data object EmailInvalid : AdminMessage

    data object PasswordRequired : AdminMessage

    data object PasswordTooShort : AdminMessage

    data object FullNameTooLong : AdminMessage

    data object NameRequired : AdminMessage

    data object MaxDevicesInvalid : AdminMessage

    data object SpeedInvalid : AdminMessage

    data object QuotaInvalid : AdminMessage

    data object TariffRequired : AdminMessage

    data object HostRequired : AdminMessage

    data object HostInvalid : AdminMessage

    data object PortInvalid : AdminMessage

    data object MtuInvalid : AdminMessage

    data object CidrInvalid : AdminMessage

    data object GatewayInvalid : AdminMessage

    data object InterfaceNameInvalid : AdminMessage

    data object NodeRequired : AdminMessage

    data object GroupRequired : AdminMessage

    data object RangeInvalid : AdminMessage

    data object ValueInvalid : AdminMessage

    data object SFloor : AdminMessage

    data object KeepaliveInvalid : AdminMessage

    data object HostsRequired : AdminMessage

    data object ShareTtlInvalid : AdminMessage

    data object RetentionInvalid : AdminMessage
}

object AdminMessages {
    fun of(error: AccountError): AdminMessage =
        when (error) {
            AccountError.Network -> AdminMessage.Network
            AccountError.Unauthorized,
            AccountError.SessionExpired -> AdminMessage.SessionExpired
            AccountError.ServerNotConfigured -> AdminMessage.Network
            AccountError.TariffRequired -> AdminMessage.TariffRequired
            AccountError.SubscriptionInactive -> AdminMessage.Conflict()
            is AccountError.Disabled -> AdminMessage.Forbidden
            is AccountError.Unexpected -> AdminMessage.Unknown
            is AccountError.Api -> ofApi(error)
        }

    private fun ofApi(error: AccountError.Api): AdminMessage =
        when {
            error.status == STATUS_UNAUTHORIZED -> AdminMessage.SessionExpired
            error.status == STATUS_FORBIDDEN -> AdminMessage.Forbidden
            error.status == STATUS_NOT_FOUND -> AdminMessage.NotFound
            error.status == STATUS_CONFLICT -> AdminMessage.Conflict(error.message)
            error.status == STATUS_TOO_MANY_REQUESTS -> AdminMessage.RateLimited
            error.status in STATUS_SERVER_ERROR..STATUS_SERVER_ERROR_MAX -> AdminMessage.Server
            else -> AdminMessage.Unknown
        }

    private const val STATUS_UNAUTHORIZED = 401
    private const val STATUS_FORBIDDEN = 403
    private const val STATUS_NOT_FOUND = 404
    private const val STATUS_CONFLICT = 409
    private const val STATUS_TOO_MANY_REQUESTS = 429
    private const val STATUS_SERVER_ERROR = 500
    private const val STATUS_SERVER_ERROR_MAX = 599
}
