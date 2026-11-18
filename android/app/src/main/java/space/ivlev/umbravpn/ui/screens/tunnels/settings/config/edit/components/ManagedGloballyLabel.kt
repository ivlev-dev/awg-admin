package space.ivlev.umbravpn.ui.screens.tunnels.settings.config.edit.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.text.DescriptionText

@Composable
fun managedGloballySupporting(value: String?): (@Composable () -> Unit)? {
    if (value == null) return null
    val shown = value.ifBlank { stringResource(R.string.none) }
    val text = stringResource(R.string.managed_globally) + " · " + shown
    return { DescriptionText(text, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}
