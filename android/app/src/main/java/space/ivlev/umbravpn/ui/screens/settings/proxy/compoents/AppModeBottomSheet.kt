package space.ivlev.umbravpn.ui.screens.settings.proxy.compoents

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon
import space.ivlev.umbravpn.util.extensions.asTitleString

@Composable
fun AppModeBottomSheet(
    onAppModeChange: (TunnelMode) -> Unit,
    tunnelMode: TunnelMode,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<TunnelMode>().map {
            val icon = it.asIcon()
            SheetOption(
                icon,
                label = it.asTitleString(context),
                onClick = {
                    onDismiss()
                    onAppModeChange(it)
                },
                description =
                    when (it) {
                        TunnelMode.VPN -> stringResource(R.string.vpn_desc)
                        TunnelMode.PROXY -> stringResource(R.string.local_proxy_desc)
                        TunnelMode.LOCK_DOWN -> stringResource(R.string.lockdown_desc)
                    },
                selected = tunnelMode == it,
            )
        },
    ) {
        onDismiss()
    }
}
