package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.BootstrapDnsProtocol
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun ResolutionMethodBottomSheet(
    onProtocolChange: (BootstrapDnsProtocol) -> Unit,
    protocol: BootstrapDnsProtocol,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<BootstrapDnsProtocol>().map {
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
        title = stringResource(R.string.resolution_method),
        description = stringResource(R.string.resolution_method_desc),
    ) {
        onDismiss()
    }
}
