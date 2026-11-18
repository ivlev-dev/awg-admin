package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.util.network.ServerUrlError

enum class AccountMessage {
    EmptyEmail,
    InvalidEmail,
    EmptyPassword,
    PasswordTooShort,
    PasswordMismatch,
    EmptyToken,
    EmptyDeviceName,
    ServerUrlEmpty,
    ServerUrlInvalid,
    ServerUrlUnsupportedScheme,
    InvalidCredentials,
    TotpRequired,
    TotpInvalid,
    TooManyAttempts,
    Network,
    ServerNotConfigured,
    SessionExpired,
    EmailNotVerified,
    PendingApproval,
    Rejected,
    DeviceLimitReached,
    EmailAlreadyRegistered,
    Conflicted,
    NotFound,
    InvalidToken,
    ServerError,
    Unknown,
    DeviceCreated,
    DeviceRenamed,
    DeviceDeleted,
    ServerChanged,
    LoggedOut,
    EmailResent,
    PasswordResetSent,
    EmailVerified,
    ApprovalStillPending,
    ServerReady,
    ServerUnavailable,
    ServerUnreachable,
}

enum class AccountActionKind {
    Login,
    Register,
    Device,
    ResetPassword,
    Verification,
    Generic,
}

object AccountMessages {
    fun of(
        error: AccountError,
        kind: AccountActionKind = AccountActionKind.Generic,
    ): AccountMessage =
        when (error) {
            AccountError.Network -> AccountMessage.Network
            AccountError.Unauthorized -> AccountMessage.InvalidCredentials
            AccountError.SessionExpired -> AccountMessage.SessionExpired
            AccountError.ServerNotConfigured -> AccountMessage.ServerNotConfigured
            is AccountError.Unexpected -> AccountMessage.Unknown
            is AccountError.Api -> ofApi(error, kind)
        }

    fun ofServerUrl(error: ServerUrlError): AccountMessage =
        when (error) {
            ServerUrlError.Empty -> AccountMessage.ServerUrlEmpty
            ServerUrlError.MissingHost -> AccountMessage.ServerUrlInvalid
            ServerUrlError.UnsupportedScheme,
            ServerUrlError.InvalidFormat -> AccountMessage.ServerUrlUnsupportedScheme
        }

    private fun ofApi(error: AccountError.Api, kind: AccountActionKind): AccountMessage =
        when {
            error.code == CODE_TOTP_REQUIRED -> AccountMessage.TotpRequired
            error.code == CODE_TOTP_INVALID -> AccountMessage.TotpInvalid
            error.code == CODE_EMAIL_NOT_VERIFIED -> AccountMessage.EmailNotVerified
            error.code == CODE_PENDING_APPROVAL -> AccountMessage.PendingApproval
            error.code == CODE_REJECTED -> AccountMessage.Rejected
            error.status == STATUS_TOO_MANY_REQUESTS || error.code == CODE_TOO_MANY_REQUESTS ->
                AccountMessage.TooManyAttempts
            error.code == CODE_INVALID_TOKEN -> AccountMessage.InvalidToken
            error.status == STATUS_CONFLICT || error.code == CODE_CONFLICT ->
                when (kind) {
                    AccountActionKind.Device -> AccountMessage.DeviceLimitReached
                    AccountActionKind.Register -> AccountMessage.EmailAlreadyRegistered
                    else -> AccountMessage.Conflicted
                }
            error.status == STATUS_NOT_FOUND || error.code == CODE_NOT_FOUND ->
                AccountMessage.NotFound
            error.status == STATUS_UNAUTHORIZED || error.status == STATUS_FORBIDDEN ->
                AccountMessage.InvalidCredentials
            error.status in STATUS_SERVER_ERROR..STATUS_SERVER_ERROR_MAX ->
                AccountMessage.ServerError
            else -> AccountMessage.Unknown
        }

    private const val CODE_TOTP_REQUIRED = "totp_required"
    private const val CODE_TOTP_INVALID = "totp_invalid"
    private const val CODE_EMAIL_NOT_VERIFIED = "email_not_verified"
    private const val CODE_PENDING_APPROVAL = "pending_approval"
    private const val CODE_REJECTED = "rejected"
    private const val CODE_TOO_MANY_REQUESTS = "too_many_requests"
    private const val CODE_INVALID_TOKEN = "invalid_token"
    private const val CODE_CONFLICT = "conflict"
    private const val CODE_NOT_FOUND = "not_found"
    private const val STATUS_UNAUTHORIZED = 401
    private const val STATUS_FORBIDDEN = 403
    private const val STATUS_NOT_FOUND = 404
    private const val STATUS_CONFLICT = 409
    private const val STATUS_TOO_MANY_REQUESTS = 429
    private const val STATUS_SERVER_ERROR = 500
    private const val STATUS_SERVER_ERROR_MAX = 599
}
