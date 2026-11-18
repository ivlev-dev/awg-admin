package space.ivlev.umbravpn.domain.model.account

sealed interface AccountError {
    data object Network : AccountError

    data object Unauthorized : AccountError

    data object SessionExpired : AccountError

    data object ServerNotConfigured : AccountError

    data class Api(val status: Int, val code: String, val message: String) : AccountError

    data class Unexpected(val message: String?) : AccountError
}

sealed interface AccountResult<out T> {
    data class Success<T>(val value: T) : AccountResult<T>

    data class Failure(val error: AccountError) : AccountResult<Nothing>

    companion object {
        fun <T> success(value: T): AccountResult<T> = Success(value)

        fun <T> failure(error: AccountError): AccountResult<T> = Failure(error)
    }
}

inline fun <T> AccountResult<T>.onSuccess(action: (T) -> Unit): AccountResult<T> {
    if (this is AccountResult.Success) action(value)
    return this
}

inline fun <T> AccountResult<T>.onFailure(action: (AccountError) -> Unit): AccountResult<T> {
    if (this is AccountResult.Failure) action(error)
    return this
}

inline fun <T, R> AccountResult<T>.map(transform: (T) -> R): AccountResult<R> =
    when (this) {
        is AccountResult.Success -> AccountResult.Success(transform(value))
        is AccountResult.Failure -> this
    }

fun <T> AccountResult<T>.valueOrNull(): T? = (this as? AccountResult.Success)?.value

fun <T> AccountResult<T>.errorOrNull(): AccountError? = (this as? AccountResult.Failure)?.error
