package space.ivlev.umbravpn.ui.screens.settings.dns.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.SplitDnsSuffixTarget
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun SplitSuffixTargetBottomSheet(
    onTargetChange: (SplitDnsSuffixTarget) -> Unit,
    target: SplitDnsSuffixTarget,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<SplitDnsSuffixTarget>().map {
            SheetOption(
                leadingIcon = it.asIcon(),
                label = it.asString(context),
                onClick = {
                    onDismiss()
                    onTargetChange(it)
                },
                description = it.asDescription(context),
                selected = target == it,
            )
        },
        title = stringResource(R.string.split_suffix_target),
        description = stringResource(R.string.split_suffix_target_sheet_desc),
    ) {
        onDismiss()
    }
}
