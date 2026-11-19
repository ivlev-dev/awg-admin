package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NetworkCheck
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.zaneschepke.networkmonitor.PrivateDnsMode
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.ui.common.banner.InfoNotice
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.state.DnsUiState
import space.ivlev.umbravpn.util.extensions.launchNetworkAndInternetSettings

@Composable
internal fun DnsSystemSection(uiState: DnsUiState) {
    val context = LocalContext.current
    val privateDnsEnabled =
        uiState.systemDnsInfo?.privateDnsMode?.let { it != PrivateDnsMode.OFF } == true
    val tunnelDnsActive = uiState.dnsSettings.tunnelDnsMode != TunnelDnsMode.Off

    InfoNotice(
        title = stringResource(R.string.private_dns_enabled_warning),
        actionLabel = stringResource(R.string.fix),
        onClick = { context.launchNetworkAndInternetSettings() },
        visible = privateDnsEnabled && tunnelDnsActive,
    )
    Column {
        GroupLabel(stringResource(R.string.system), Modifier.padding(horizontal = 16.dp))

        SurfaceRow(
            leading = { Icon(Icons.Outlined.NetworkCheck, contentDescription = null) },
            title = stringResource(R.string.current_system_dns),
            description = {
                val dnsInfo = uiState.systemDnsInfo

                val descriptionText =
                    if (dnsInfo == null) {
                        stringResource(R.string.no_system_dns_information)
                    } else {
                        when (dnsInfo.privateDnsMode) {
                            PrivateDnsMode.OFF -> {
                                if (dnsInfo.servers.isNotEmpty()) {
                                    stringResource(
                                        R.string.system_dns_servers,
                                        dnsInfo.servers.joinToString(", "),
                                    )
                                } else {
                                    stringResource(R.string.no_system_dns_detected)
                                }
                            }

                            PrivateDnsMode.AUTOMATIC -> {
                                buildString {
                                    append(stringResource(R.string.private_dns_automatic))

                                    append("\n")

                                    append(
                                        if (dnsInfo.servers.isNotEmpty()) {
                                            stringResource(
                                                R.string.system_dns_servers,
                                                dnsInfo.servers.joinToString(", "),
                                            )
                                        } else {
                                            stringResource(R.string.no_system_dns_detected)
                                        },
                                    )
                                }
                            }

                            PrivateDnsMode.HOSTNAME -> {
                                stringResource(
                                    R.string.private_dns_hostname,
                                    dnsInfo.privateDnsHostname ?: stringResource(R.string.unknown),
                                )
                            }
                        }
                    }

                DescriptionText(descriptionText)
            },
        )
    }
}
