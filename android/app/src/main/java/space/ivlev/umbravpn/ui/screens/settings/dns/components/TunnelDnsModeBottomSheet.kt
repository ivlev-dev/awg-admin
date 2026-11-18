package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.TunnelDnsMode
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun TunnelDnsModeBottomSheet(
    onTunnelDnsModeChange: (TunnelDnsMode) -> Unit,
    tunnelDnsMode: TunnelDnsMode,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<TunnelDnsMode>().map {
            val icon = it.asIcon()
            SheetOption(
                icon,
                label = it.asString(context),
                onClick = {
                    onDismiss()
                    onTunnelDnsModeChange(it)
                },
                description = it.asDescription(context),
                selected = tunnelDnsMode == it,
            )
        },
        title = stringResource(R.string.tunnel_dns_mode),
        description = stringResource(R.string.tunnel_dns_mode_desc),
    ) {
        onDismiss()
    }
}
