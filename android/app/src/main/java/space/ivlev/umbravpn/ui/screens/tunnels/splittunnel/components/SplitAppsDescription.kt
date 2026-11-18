package space.ivlev.umbravpn.ui.screens.tunnels.splittunnel.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.state.AppliedSplitApps
import space.ivlev.umbravpn.ui.state.SplitAppListSummary

@Composable
fun splitAppsLabel(summary: SplitAppListSummary): String {
    return when (summary) {
        is SplitAppListSummary.Tunneled ->
            pluralStringResource(R.plurals.apps_tunneled, summary.count, summary.count)
        is SplitAppListSummary.Bypassed ->
            pluralStringResource(R.plurals.apps_bypassed, summary.count, summary.count)
        SplitAppListSummary.AllTunneled -> stringResource(R.string.all_apps_tunneled)
    }
}

@Composable
fun SplitAppsDescription(applied: AppliedSplitApps) {
    val label = splitAppsLabel(applied.summary)
    val text =
        if (applied.managedGlobally) {
            stringResource(R.string.managed_globally_detail, label)
        } else {
            label
        }
    DescriptionText(text)
}
