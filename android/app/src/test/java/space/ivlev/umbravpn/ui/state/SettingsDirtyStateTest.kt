package space.ivlev.umbravpn.ui.state

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.domain.model.DnsSettings
import space.ivlev.umbravpn.domain.model.ProxySettings
import space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.state.SplitBehavior
import space.ivlev.umbravpn.viewmodel.GlobalAmneziaUiState

class SettingsDirtyStateTest {

    @Test
    fun dnsScreenIsCleanRightAfterLoading() {
        val settings = DnsSettings()
        val state = DnsUiState(dnsSettings = settings, savedDnsSettings = settings)

        assertFalse(state.isDirty)
    }

    @Test
    fun dnsScreenBecomesDirtyOnEditAndCleanAfterSave() {
        val settings = DnsSettings()
        val state = DnsUiState(dnsSettings = settings, savedDnsSettings = settings)

        val edited =
            state.copy(dnsSettings = settings.copy(tunnelDnsMode = TunnelDnsMode.Encrypted))
        assertTrue(edited.isDirty)
        assertFalse(edited.copy(savedDnsSettings = edited.dnsSettings).isDirty)
    }

    @Test
    fun dnsGlobalServersArePartOfDirtyCheck() {
        val state = DnsUiState(savedGlobalDnsServers = "1.1.1.1")

        assertFalse(state.copy(globalDnsServers = "1.1.1.1").isDirty)
        assertTrue(state.copy(globalDnsServers = "8.8.8.8").isDirty)
    }

    @Test
    fun proxyScreenTracksEveryEditedField() {
        val settings = ProxySettings()
        val clean =
            ProxySettingsUiState(
                proxySettings = settings,
                socks5Enabled = settings.socks5ProxyEnabled,
                httpEnabled = settings.httpProxyEnabled,
                allowSocks4 = settings.allowSocks4,
                socksBindAddress = settings.socks5ProxyBindAddress.orEmpty(),
                httpBindAddress = settings.httpProxyBindAddress.orEmpty(),
                proxyUsername = settings.proxyUsername.orEmpty(),
                proxyPassword = settings.proxyPassword.orEmpty(),
            )

        assertFalse(clean.isDirty)
        assertTrue(clean.copy(socks5Enabled = !settings.socks5ProxyEnabled).isDirty)
        assertTrue(clean.copy(httpEnabled = !settings.httpProxyEnabled).isDirty)
        assertTrue(clean.copy(socksBindAddress = "127.0.0.1:1234").isDirty)
        assertTrue(clean.copy(proxyPassword = "secret").isDirty)
        assertFalse(
            clean.copy(socksBindAddress = settings.socks5ProxyBindAddress.orEmpty()).isDirty,
        )
    }

    @Test
    fun splitTunnelEditorTracksBehaviorAndAppSets() {
        val clean = SplitTunnelUiState(initialized = true)

        assertFalse(clean.isDirty)
        assertTrue(clean.copy(activeBehavior = SplitBehavior.INCLUDE).isDirty)
        assertTrue(clean.copy(includedPackages = setOf("org.example")).isDirty)
        assertTrue(clean.copy(excludedPackages = setOf("org.example")).isDirty)

        val saved =
            clean.copy(
                activeBehavior = SplitBehavior.INCLUDE,
                includedPackages = setOf("org.example"),
                savedBehavior = SplitBehavior.INCLUDE,
                savedIncludedPackages = setOf("org.example"),
            )
        assertFalse(saved.isDirty)
    }

    @Test
    fun globalAmneziaEditorIsDirtyOnlyAfterDraftEdit() {
        val clean = GlobalAmneziaUiState(isLoading = false)
        assertFalse(clean.isDirty)

        val edited = clean.copy(interfaceDraft = clean.interfaceDraft.copy(mtu = "1400"))
        assertTrue(edited.isDirty)
        assertFalse(edited.copy(savedInterfaceDraft = edited.interfaceDraft).isDirty)
    }
}
