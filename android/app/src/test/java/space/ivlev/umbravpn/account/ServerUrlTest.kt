package space.ivlev.umbravpn.account

import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.util.network.ServerUrlError
import space.ivlev.umbravpn.util.network.ServerUrlValidation
import space.ivlev.umbravpn.util.network.normalizeServerUrl
import space.ivlev.umbravpn.util.network.validateServerUrl

class ServerUrlTest {

    @Test
    fun releaseRejectsPlainHttp() {
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlError.InsecureScheme),
            validateServerUrl("http://10.0.0.5:8080"),
        )
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlError.InsecureScheme),
            validateServerUrl("http://panel.example.com", allowHttp = false),
        )
    }

    @Test
    fun debugMayUsePlainHttp() {
        assertEquals(
            ServerUrlValidation.Valid("http://10.0.0.5:8080"),
            validateServerUrl("http://10.0.0.5:8080/", allowHttp = true),
        )
    }

    @Test
    fun httpsIsAcceptedInRelease() {
        assertEquals(
            ServerUrlValidation.Valid("https://panel.example.com"),
            validateServerUrl("panel.example.com"),
        )
    }

    @Test
    fun rejectsUserInfoAndFragment() {
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlError.UserInfoNotAllowed),
            validateServerUrl("https://user:pass@panel.example.com"),
        )
        assertEquals(
            ServerUrlValidation.Invalid(ServerUrlError.FragmentNotAllowed),
            validateServerUrl("https://panel.example.com/#section"),
        )
    }

    @Test
    fun stripsWhitespaceAndTrailingSlashes() {
        assertEquals(
            "https://panel.example.com",
            normalizeServerUrl("  https://panel.example.com///  "),
        )
        assertEquals("https://panel.example.com", normalizeServerUrl("https://panel.example.com/"))
    }

    @Test
    fun addsHttpsSchemeWhenMissing() {
        assertEquals("https://panel.example.com", normalizeServerUrl("panel.example.com"))
        assertEquals(
            "https://panel.example.com:8443",
            normalizeServerUrl(" panel.example.com:8443/ "),
        )
    }

    @Test
    fun keepsExplicitHttpScheme() {
        assertEquals("http://10.0.0.5:8080", normalizeServerUrl("http://10.0.0.5:8080/"))
    }

    @Test
    fun keepsPathPrefix() {
        assertEquals("https://example.com/panel", normalizeServerUrl("https://example.com/panel/"))
    }

    @Test
    fun blankInputBecomesEmpty() {
        assertEquals("", normalizeServerUrl(""))
        assertEquals("", normalizeServerUrl("   "))
        assertEquals("", normalizeServerUrl("https://"))
    }

    @Test
    fun settingsRepositoryStoresNormalizedUrl() = runTest {
        val settings = FakeAccountSettingsRepository("  https://panel.test/// ")

        assertEquals("https://panel.test", settings.serverUrl())

        settings.setServerUrl(" panel.test/api/ ")

        assertEquals("https://panel.test/api", settings.serverUrl())
        assertEquals("https://panel.test/api", settings.serverUrlFlow.first())
        assertFalse(settings.termsAccepted())
        settings.setTermsAccepted(true)
        assertTrue(settings.termsAccepted())
        assertTrue(settings.termsAcceptedFlow.first())
    }

    @Test
    fun loginUsesNormalizedBaseUrl() = runTest {
        val env =
            createEnvironment(rawServerUrl = "  panel.test///  ") {
                jsonResponse(HttpStatusCode.OK, authJson())
            }

        env.authRepository.login("alice", "secret").requireSuccess()

        assertEquals(
            "https://panel.test/api/v1/auth/login",
            env.requests.single().url.toString(),
        )
    }
}
