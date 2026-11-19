package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.theme.LocalStatusColors
import space.ivlev.umbravpn.ui.theme.StatusKind

@Composable
internal fun pingLatencyLabel(latency: Double): String {
    return if (latency == Double.MAX_VALUE) stringResource(R.string.ping_unreachable)
    else "${latency.toInt()}ms"
}

@Composable
internal fun pingLatencyColor(latency: Double): Color {
    val statusColors = LocalStatusColors.current
    return statusColors.colorFor(
        when {
            latency == Double.MAX_VALUE -> StatusKind.ERROR
            latency <= 50.0 -> StatusKind.SUCCESS
            latency <= 150.0 -> StatusKind.WARNING
            else -> StatusKind.ERROR
        },
    )
}
