package space.ivlev.umbravpn.ui.screens.settings.monitoring.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import kotlin.enums.enumEntries
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.enums.StatisticRefresh
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.extensions.asIcon

@Composable
fun StatisticRefreshBottomSheet(
    onRefreshChange: (StatisticRefresh) -> Unit,
    refresh: StatisticRefresh,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    CustomBottomSheet(
        enumEntries<StatisticRefresh>().map {
            SheetOption(
                leadingIcon = it.asIcon(),
                label = it.asString(context),
                onClick = {
                    onDismiss()
                    onRefreshChange(it)
                },
                description = it.asDescription(context),
                selected = refresh == it,
            )
        },
        title = stringResource(R.string.refresh_rate),
        description = stringResource(R.string.refresh_rate_desc),
    ) {
        onDismiss()
    }
}
