package space.ivlev.umbravpn.ui.screens.settings.dns

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.TunnelDnsProtocol
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.common.dialog.rememberRestartToApplyChanges
import space.ivlev.umbravpn.ui.screens.settings.dns.components.DnsPeerResolutionSection
import space.ivlev.umbravpn.ui.screens.settings.dns.components.DnsSystemSection
import space.ivlev.umbravpn.ui.screens.settings.dns.components.DnsTunnelSection
import space.ivlev.umbravpn.ui.screens.settings.dns.components.ProtocolBottomSheet
import space.ivlev.umbravpn.ui.screens.settings.dns.components.ResolutionMethodBottomSheet
import space.ivlev.umbravpn.ui.screens.settings.dns.components.SplitSuffixTargetBottomSheet
import space.ivlev.umbravpn.ui.screens.settings.dns.components.TransitDnsPolicyBottomSheet
import space.ivlev.umbravpn.ui.screens.settings.dns.components.TunnelDnsModeBottomSheet
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.viewmodel.DnsViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun DnsSettingsScreen(
    viewModel: DnsViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val uiState by viewModel.collectAsState()
    val sharedUiState by sharedViewModel.collectAsState()
    var showAppModeSheet by rememberSaveable { mutableStateOf(false) }
    var showResolutionMethodSheet by rememberSaveable { mutableStateOf(false) }
    var showProtocolSheet by rememberSaveable { mutableStateOf(false) }
    var showTransitPolicySheet by rememberSaveable { mutableStateOf(false) }
    var showSplitSuffixTargetSheet by rememberSaveable { mutableStateOf(false) }
    var showDiscardDialog by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(uiState.isDirty) { sharedViewModel.setScreenDirty(uiState.isDirty) }
    DisposableEffect(Unit) { onDispose { sharedViewModel.setScreenDirty(false) } }

    if (uiState.isLoading) {
        LoadingPlaceholder()
        return
    }

    val requestApply =
        rememberRestartToApplyChanges(
            needsRestart = uiState.hasActiveTunnel,
            onSave = viewModel::save,
        )

    sharedViewModel.collectSideEffect { effect ->
        when (effect) {
            is LocalSideEffect.SaveChanges -> requestApply()
            is LocalSideEffect.RequestBack ->
                if (uiState.isDirty) showDiscardDialog = true else navController.pop()
            else -> Unit
        }
    }

    BackHandler(enabled = uiState.isDirty) { showDiscardDialog = true }

    if (showDiscardDialog) {
        InfoDialog(
            onDismiss = { showDiscardDialog = false },
            onAttest = {
                showDiscardDialog = false
                navController.pop()
            },
            title = stringResource(R.string.discard_changes_title),
            body = { Text(stringResource(R.string.discard_changes_body)) },
            confirmText = stringResource(R.string.discard_changes_confirm),
            destructive = true,
        )
    }

    if (showAppModeSheet) {
        TunnelDnsModeBottomSheet(
            onTunnelDnsModeChange = viewModel::setTunnelDnsMode,
            uiState.dnsSettings.tunnelDnsMode,
        ) {
            showAppModeSheet = false
        }
    }

    if (showResolutionMethodSheet) {
        ResolutionMethodBottomSheet(
            onProtocolChange = viewModel::setBootstrapDnsProtocol,
            protocol = uiState.dnsSettings.bootstrapDnsProtocol,
        ) {
            showResolutionMethodSheet = false
        }
    }

    val isSplitMode = uiState.dnsSettings.tunnelDnsMode.isSplitMode()
    if (showProtocolSheet) {
        ProtocolBottomSheet(
            options =
                if (isSplitMode) TunnelDnsProtocol.entries
                else TunnelDnsProtocol.entries.filter { it != TunnelDnsProtocol.Plain },
            onProtocolChange = viewModel::setTunnelDnsProtocol,
            protocol = uiState.dnsSettings.tunnelDnsProtocol,
        ) {
            showProtocolSheet = false
        }
    }

    if (showTransitPolicySheet) {
        TransitDnsPolicyBottomSheet(
            onPolicyChange = viewModel::setForeignDnsPolicy,
            policy = uiState.dnsSettings.foreignDnsPolicy,
        ) {
            showTransitPolicySheet = false
        }
    }

    if (showSplitSuffixTargetSheet) {
        SplitSuffixTargetBottomSheet(
            onTargetChange = viewModel::setSplitSuffixTarget,
            target = uiState.dnsSettings.splitSuffixTarget,
        ) {
            showSplitSuffixTargetSheet = false
        }
    }

    Column(
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Top),
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
    ) {
        DnsSystemSection(uiState = uiState)
        DnsPeerResolutionSection(
            uiState = uiState,
            viewModel = viewModel,
            onOpenResolutionMethodSheet = { showResolutionMethodSheet = true },
        )
        DnsTunnelSection(
            uiState = uiState,
            tunnelMode = sharedUiState.tunnelMode,
            viewModel = viewModel,
            onOpenModeSheet = { showAppModeSheet = true },
            onOpenProtocolSheet = { showProtocolSheet = true },
            onOpenSplitSuffixTargetSheet = { showSplitSuffixTargetSheet = true },
            onOpenTransitPolicySheet = { showTransitPolicySheet = true },
        )
    }
}
