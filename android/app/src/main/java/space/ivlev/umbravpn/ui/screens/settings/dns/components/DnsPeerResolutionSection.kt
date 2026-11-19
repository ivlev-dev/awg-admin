package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.BootstrapDnsProtocol
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.common.textbox.ConfigurationTextBox
import space.ivlev.umbravpn.ui.state.DnsUiState
import space.ivlev.umbravpn.util.extensions.asString
import space.ivlev.umbravpn.viewmodel.DnsViewModel

@Composable
internal fun DnsPeerResolutionSection(
    uiState: DnsUiState,
    viewModel: DnsViewModel,
    onOpenResolutionMethodSheet: () -> Unit,
) {
    val context = LocalContext.current

    Column {
        GroupLabel(
            stringResource(R.string.peer_resolution),
            Modifier.padding(horizontal = 16.dp),
        )
        SurfaceRow(
            leading = { Icon(Icons.Outlined.Dns, contentDescription = null) },
            trailing = { modifier ->
                IconButton(onClick = onOpenResolutionMethodSheet, modifier) {
                    Icon(
                        Icons.Outlined.ExpandMore,
                        contentDescription = stringResource(R.string.select),
                    )
                }
            },
            title = stringResource(R.string.resolution_method),
            description = {
                DescriptionText(uiState.dnsSettings.bootstrapDnsProtocol.asString(context))
            },
            onClick = onOpenResolutionMethodSheet,
        )
        AnimatedVisibility(
            uiState.dnsSettings.bootstrapDnsProtocol != BootstrapDnsProtocol.SYSTEM,
        ) {
            ConfigurationTextBox(
                modifier = Modifier.padding(horizontal = 16.dp).padding(top = 8.dp).fillMaxWidth(),
                hint = stringResource(R.string.dns_endpoint_hint),
                label = stringResource(R.string.dns_endpoint_label),
                value = uiState.dnsSettings.bootstrapDnsEndpoint ?: "",
                isError = uiState.bootstrapEndpointError != null,
                onValueChange = viewModel::setBootstrapDnsEndpoint,
            )
        }
    }
}
