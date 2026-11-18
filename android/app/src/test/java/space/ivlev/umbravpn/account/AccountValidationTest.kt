package space.ivlev.umbravpn.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.account.AccountValidation
import space.ivlev.umbravpn.util.network.ServerUrlError
import space.ivlev.umbravpn.util.network.ServerUrlValidation
import space.ivlev.umbravpn.util.network.validateServerUrl

class AccountValidationTest {
    @Test
    fun acceptsServerWithoutSchemeAndAddsHttps() {
        val result = validateServerUrl("panel.example.com")

        assertTrue(result is ServerUrlValidation.Valid)
        assertEquals("https://panel.example.com", (result as ServerUrlValidation.Valid).url)
    }

    @Test
    fun acceptsHttpAndPath() {
        assertEquals(
            "http://10.0.2.2:8080",
            valid("http://10.0.2.2:8080/"),
        )
        assertEquals(
            "https://example.com/panel",
            valid(" https://example.com/panel/ "),
        )
    }

    @Test
    fun rejectsEmptyInvalidAndUnsupportedSchemes() {
        assertEquals(ServerUrlError.Empty, invalid("   "))
        assertEquals(ServerUrlError.UnsupportedScheme, invalid("ftp://panel.example.com"))
        assertEquals(ServerUrlError.InvalidFormat, invalid("not a valid address"))
        assertEquals(ServerUrlError.MissingHost, invalid("https://"))
        assertEquals(ServerUrlError.MissingHost, invalid("https:///path"))
    }

    @Test
    fun loginAllowsAnyFilledPassword() {
        assertTrue(AccountValidation.login("alice@example.com", "x").isValid)
        assertEquals(
            AccountMessage.EmptyPassword,
            AccountValidation.login("alice@example.com", "").passwordError,
        )
        assertEquals(AccountMessage.EmptyEmail, AccountValidation.login("", "secret").emailError)
        assertEquals(
            AccountMessage.InvalidEmail,
            AccountValidation.login("alice", "secret").emailError,
        )
        assertTrue(AccountValidation.login("alice@local", "secret").isValid)
    }

    @Test
    fun registerRequiresMinLengthAndMatchingConfirmation() {
        assertTrue(AccountValidation.register("alice@example.com", "12345678", "12345678").isValid)

        assertEquals(
            AccountMessage.PasswordTooShort,
            AccountValidation.register("alice@example.com", "1234567", "1234567").passwordError,
        )
        assertEquals(
            AccountMessage.PasswordMismatch,
            AccountValidation.register("alice@example.com", "12345678", "87654321")
                .confirmationError,
        )
    }

    @Test
    fun resetRequiresTokenAndPassword() {
        val missingToken = AccountValidation.reset("", "12345678", "12345678")
        assertEquals(AccountMessage.EmptyToken, missingToken.tokenError)

        val valid = AccountValidation.reset("token", "12345678", "12345678")
        assertNull(valid.tokenError)
        assertNull(valid.passwordError)
        assertNull(valid.confirmationError)
    }

    private fun valid(raw: String): String =
        (validateServerUrl(raw) as ServerUrlValidation.Valid).url

    private fun invalid(raw: String): ServerUrlError =
        (validateServerUrl(raw) as ServerUrlValidation.Invalid).error
}
