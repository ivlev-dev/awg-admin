package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.TunnelDnsProtocol
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun ProtocolBottomSheet(
    options: List<TunnelDnsProtocol>,
    onProtocolChange: (TunnelDnsProtocol) -> Unit,
    protocol: TunnelDnsProtocol,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        options.map {
            SheetOption(
                leadingIcon = it.asIcon(),
                label = it.asString(context),
                onClick = {
                    onDismiss()
                    onProtocolChange(it)
                },
                description = it.asDescription(context),
                selected = protocol == it,
            )
        },
        title = stringResource(R.string.protocol),
        description = stringResource(R.string.protocol_desc),
    ) {
        onDismiss()
    }
}
