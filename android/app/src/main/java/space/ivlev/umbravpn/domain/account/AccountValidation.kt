package space.ivlev.umbravpn.domain.account

data class LoginValidation(
    val emailError: AccountMessage?,
    val passwordError: AccountMessage?,
) {
    val isValid: Boolean
        get() = emailError == null && passwordError == null
}

data class RegisterValidation(
    val emailError: AccountMessage?,
    val passwordError: AccountMessage?,
    val confirmationError: AccountMessage?,
) {
    val isValid: Boolean
        get() = emailError == null && passwordError == null && confirmationError == null
}

data class ResetValidation(
    val tokenError: AccountMessage?,
    val passwordError: AccountMessage?,
    val confirmationError: AccountMessage?,
) {
    val isValid: Boolean
        get() = tokenError == null && passwordError == null && confirmationError == null
}

object AccountValidation {
    const val MIN_PASSWORD_LENGTH = 8

    private val emailPattern = Regex("^[^@\\s]+@[^@\\s]+$")

    fun emailError(value: String): AccountMessage? {
        val email = value.trim()
        return when {
            email.isEmpty() -> AccountMessage.EmptyEmail
            !emailPattern.matches(email) -> AccountMessage.InvalidEmail
            else -> null
        }
    }

    fun login(email: String, password: String): LoginValidation =
        LoginValidation(
            emailError = emailError(email),
            passwordError = if (password.isEmpty()) AccountMessage.EmptyPassword else null,
        )

    fun register(email: String, password: String, confirmation: String): RegisterValidation =
        RegisterValidation(
            emailError = emailError(email),
            passwordError =
                when {
                    password.isEmpty() -> AccountMessage.EmptyPassword
                    password.length < MIN_PASSWORD_LENGTH -> AccountMessage.PasswordTooShort
                    else -> null
                },
            confirmationError =
                if (password != confirmation) AccountMessage.PasswordMismatch else null,
        )

    fun reset(token: String, password: String, confirmation: String): ResetValidation =
        ResetValidation(
            tokenError = if (token.trim().isEmpty()) AccountMessage.EmptyToken else null,
            passwordError =
                when {
                    password.isEmpty() -> AccountMessage.EmptyPassword
                    password.length < MIN_PASSWORD_LENGTH -> AccountMessage.PasswordTooShort
                    else -> null
                },
            confirmationError =
                if (password != confirmation) AccountMessage.PasswordMismatch else null,
        )

    fun deviceNameError(value: String): AccountMessage? =
        if (value.trim().isEmpty()) AccountMessage.EmptyDeviceName else null
}
