package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.wgtunnel.backend.state.ActiveTunnel
import space.ivlev.umbravpn.util.extensions.statusText
import space.ivlev.umbravpn.util.extensions.uptimeText

@Composable
fun TunnelOverviewSection(activeTunnel: ActiveTunnel, now: Long) {
    val context = LocalContext.current
    val style = MaterialTheme.typography.bodySmall
    val color = MaterialTheme.colorScheme.outline

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(text = activeTunnel.statusText(context), style = style, color = color)

        activeTunnel.uptimeText(context, now)?.let { Text(text = it, style = style, color = color) }
    }
}
