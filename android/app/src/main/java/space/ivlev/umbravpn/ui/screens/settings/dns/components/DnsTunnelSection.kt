package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.AltRoute
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Router
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.constants.TunnelDns
import space.ivlev.umbravpn.domain.enums.ForeignDnsPolicy
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.domain.enums.TunnelDnsProtocol
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.button.ThemedSwitch
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.common.textbox.ConfigurationTextBox
import space.ivlev.umbravpn.ui.state.DnsUiState
import space.ivlev.umbravpn.ui.theme.Disabled
import space.ivlev.umbravpn.util.extensions.asString
import space.ivlev.umbravpn.viewmodel.DnsViewModel

@Composable
internal fun DnsTunnelSection(
    uiState: DnsUiState,
    tunnelMode: TunnelMode,
    viewModel: DnsViewModel,
    onOpenModeSheet: () -> Unit,
    onOpenProtocolSheet: () -> Unit,
    onOpenSplitSuffixTargetSheet: () -> Unit,
    onOpenTransitPolicySheet: () -> Unit,
) {
    val context = LocalContext.current
    val isSplitMode = uiState.dnsSettings.tunnelDnsMode.isSplitMode()

    Column {
        GroupLabel(stringResource(R.string.tunnel_dns), Modifier.padding(horizontal = 16.dp))
        SurfaceRow(
            leading = {
                Icon(ImageVector.vectorResource(R.drawable.sdk), contentDescription = null)
            },
            trailing = { modifier ->
                IconButton(onClick = onOpenModeSheet, modifier) {
                    Icon(
                        Icons.Outlined.ExpandMore,
                        contentDescription = stringResource(R.string.select),
                    )
                }
            },
            title = stringResource(R.string.tunnel_dns_mode),
            description = { DescriptionText(uiState.dnsSettings.tunnelDnsMode.asString(context)) },
            onClick = onOpenModeSheet,
        )
        AnimatedVisibility(
            visible = uiState.dnsSettings.tunnelDnsMode == TunnelDnsMode.Off,
            enter = fadeIn() + expandVertically(expandFrom = Alignment.Top),
            exit = fadeOut() + shrinkVertically(shrinkTowards = Alignment.Top),
        ) {
            Column {
                SurfaceRow(
                    leading = { Icon(Icons.Outlined.Dns, contentDescription = null) },
                    title = stringResource(R.string.global_tunnel_dns),
                    trailing = { modifier ->
                        ThemedSwitch(
                            checked = uiState.dnsSettings.isGlobalTunnelConfigDnsEnabled,
                            onClick = viewModel::setGlobalTunnelDnsEnabled,
                            modifier = modifier,
                        )
                    },
                    description = {
                        DescriptionText(stringResource(R.string.global_tunnel_dns_desc))
                    },
                    onClick = {
                        viewModel.setGlobalTunnelDnsEnabled(
                            !uiState.dnsSettings.isGlobalTunnelConfigDnsEnabled,
                        )
                    },
                )
                AnimatedVisibility(
                    visible = uiState.dnsSettings.isGlobalTunnelConfigDnsEnabled,
                    enter = fadeIn() + expandVertically(expandFrom = Alignment.Top),
                    exit = fadeOut() + shrinkVertically(shrinkTowards = Alignment.Top),
                ) {
                    ConfigurationTextBox(
                        modifier =
                            Modifier.padding(horizontal = 16.dp).padding(top = 8.dp).fillMaxWidth(),
                        hint =
                            stringResource(
                                    R.string.hint_template,
                                    stringResource(R.string.comma_separated),
                                )
                                .lowercase(Locale.current.platformLocale),
                        label = stringResource(R.string.dns_servers),
                        value = uiState.globalDnsServers,
                        onValueChange = viewModel::setGlobalDnsServers,
                    )
                }
            }
        }
        AnimatedVisibility(
            uiState.dnsSettings.tunnelDnsMode in
                setOf(TunnelDnsMode.Encrypted, TunnelDnsMode.Split, TunnelDnsMode.AllLocal),
        ) {
            Column {
                val showCustomServer =
                    !isSplitMode ||
                        !(uiState.dnsSettings.useTunnelDnsServersInSplit &&
                            uiState.dnsSettings.tunnelDnsProtocol == TunnelDnsProtocol.Plain)
                if (uiState.dnsSettings.tunnelDnsMode != TunnelDnsMode.AllLocal) {
                    SurfaceRow(
                        leading = { Icon(Icons.Outlined.Router, contentDescription = null) },
                        trailing = { modifier ->
                            IconButton(onClick = onOpenProtocolSheet, modifier) {
                                Icon(
                                    Icons.Outlined.ExpandMore,
                                    contentDescription = stringResource(R.string.select),
                                )
                            }
                        },
                        title = stringResource(R.string.protocol),
                        description = {
                            DescriptionText(
                                uiState.dnsSettings.tunnelDnsProtocol.asString(context),
                            )
                        },
                        onClick = onOpenProtocolSheet,
                    )
                }
                if (
                    isSplitMode && uiState.dnsSettings.tunnelDnsProtocol == TunnelDnsProtocol.Plain
                ) {
                    SurfaceRow(
                        leading = { Icon(Icons.Outlined.Route, null) },
                        title = stringResource(R.string.use_tunnel_dns_servers),
                        trailing = {
                            ThemedSwitch(
                                checked = uiState.dnsSettings.useTunnelDnsServersInSplit,
                                onClick = viewModel::setUseTunnelDnsServersInSplit,
                            )
                        },
                        onClick = {
                            viewModel.setUseTunnelDnsServersInSplit(
                                !uiState.dnsSettings.useTunnelDnsServersInSplit,
                            )
                        },
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (
                        showCustomServer &&
                            uiState.dnsSettings.tunnelDnsMode != TunnelDnsMode.AllLocal
                    ) {
                        ConfigurationTextBox(
                            modifier =
                                Modifier.padding(horizontal = 16.dp)
                                    .padding(top = 8.dp)
                                    .fillMaxWidth(),
                            hint = stringResource(R.string.dns_endpoint_hint),
                            label = stringResource(R.string.dns_endpoint_label),
                            value = uiState.dnsSettings.tunnelDnsEndpoint ?: "",
                            isError = uiState.tunnelEndpointError != null,
                            onValueChange = viewModel::setTunnelDnsEndpoint,
                        )
                    }
                    AnimatedVisibility(isSplitMode) {
                        Column {
                            ConfigurationTextBox(
                                modifier =
                                    Modifier.padding(horizontal = 16.dp)
                                        .padding(top = 8.dp)
                                        .fillMaxWidth(),
                                hint = TunnelDns.DEFAULT_SPLIT_SUFFIXES.joinToString(),
                                label = stringResource(R.string.domain_suffixes),
                                value = uiState.dnsSettings.localSuffixes ?: "",
                                isError = uiState.localSuffixesError != null,
                                onValueChange = viewModel::setLocalDomainSuffixes,
                            )
                            SurfaceRow(
                                leading = {
                                    Icon(
                                        Icons.AutoMirrored.Outlined.AltRoute,
                                        contentDescription = null,
                                    )
                                },
                                trailing = { modifier ->
                                    IconButton(
                                        onClick = onOpenSplitSuffixTargetSheet,
                                        modifier,
                                    ) {
                                        Icon(
                                            Icons.Outlined.ExpandMore,
                                            contentDescription = stringResource(R.string.select),
                                        )
                                    }
                                },
                                title = stringResource(R.string.split_suffix_target),
                                description = {
                                    DescriptionText(
                                        uiState.dnsSettings.splitSuffixTarget.asString(context),
                                    )
                                },
                                onClick = onOpenSplitSuffixTargetSheet,
                            )
                        }
                    }
                }
                val transitPolicyLocked = tunnelMode == TunnelMode.PROXY
                val transitPolicyValue =
                    if (transitPolicyLocked) ForeignDnsPolicy.Redirect
                    else uiState.dnsSettings.foreignDnsPolicy
                SurfaceRow(
                    leading = {
                        Icon(
                            Icons.Outlined.Dns,
                            contentDescription = null,
                            tint =
                                if (transitPolicyLocked) Disabled
                                else MaterialTheme.colorScheme.onSurface,
                        )
                    },
                    trailing = { modifier ->
                        IconButton(
                            onClick = onOpenTransitPolicySheet,
                            modifier,
                            enabled = !transitPolicyLocked,
                        ) {
                            Icon(
                                Icons.Outlined.ExpandMore,
                                contentDescription = stringResource(R.string.select),
                            )
                        }
                    },
                    title = stringResource(R.string.transit_dns_policy),
                    description = {
                        DescriptionText(
                            transitPolicyValue.asString(context),
                            disabled = transitPolicyLocked,
                        )
                    },
                    enabled = !transitPolicyLocked,
                    onClick = onOpenTransitPolicySheet,
                )
            }
        }
    }
}
