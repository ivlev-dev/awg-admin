package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.ForeignDnsPolicy
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun TransitDnsPolicyBottomSheet(
    onPolicyChange: (ForeignDnsPolicy) -> Unit,
    policy: ForeignDnsPolicy,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<ForeignDnsPolicy>().map {
            SheetOption(
                leadingIcon = it.asIcon(),
                label = it.asString(context),
                onClick = {
                    onDismiss()
                    onPolicyChange(it)
                },
                description = it.asDescription(context),
                selected = policy == it,
            )
        },
        title = stringResource(R.string.transit_dns_policy),
        description = stringResource(R.string.transit_dns_policy_desc),
    ) {
        onDismiss()
    }
}
