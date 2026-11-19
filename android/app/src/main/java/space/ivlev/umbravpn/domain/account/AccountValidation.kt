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
    val fullNameError: AccountMessage? = null,
) {
    val isValid: Boolean
        get() =
            emailError == null &&
                passwordError == null &&
                confirmationError == null &&
                fullNameError == null
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
    const val FULL_NAME_MAX_LENGTH = 200

    private val emailPattern = Regex("^[^@\\s]+@[^@\\s]+$")

    fun emailError(value: String): AccountMessage? {
        val email = value.trim()
        return when {
            email.isEmpty() -> AccountMessage.EmptyEmail
            !emailPattern.matches(email) -> AccountMessage.InvalidEmail
            else -> null
        }
    }

    fun optionalFullNameError(value: String?): AccountMessage? =
        if ((value?.trim()?.length ?: 0) > FULL_NAME_MAX_LENGTH) {
            AccountMessage.FullNameTooLong
        } else {
            null
        }

    fun profileFullNameError(value: String?): AccountMessage? {
        val name = value?.trim().orEmpty()
        return when {
            name.isEmpty() -> AccountMessage.EmptyFullName
            name.length > FULL_NAME_MAX_LENGTH -> AccountMessage.FullNameTooLong
            else -> null
        }
    }

    fun login(email: String, password: String): LoginValidation =
        LoginValidation(
            emailError = emailError(email),
            passwordError = if (password.isEmpty()) AccountMessage.EmptyPassword else null,
        )

    fun register(
        email: String,
        password: String,
        confirmation: String,
        fullName: String? = null,
    ): RegisterValidation =
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
            fullNameError = optionalFullNameError(fullName),
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
