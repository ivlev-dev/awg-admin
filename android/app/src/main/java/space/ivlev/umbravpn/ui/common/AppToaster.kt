package space.ivlev.umbravpn.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.surfaceColorAtElevation
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.dokar.sonner.TextToastAction
import com.dokar.sonner.ToastCloseButton
import com.dokar.sonner.ToastType
import com.dokar.sonner.Toaster
import com.dokar.sonner.ToasterState
import space.ivlev.umbravpn.ui.theme.Heart
import space.ivlev.umbravpn.ui.theme.LocalStatusColors

@Composable
fun AppToaster(state: ToasterState) {
    Toaster(
        state = state,
        maxVisibleToasts = 1,
        alignment = Alignment.BottomCenter,
        offset = IntOffset(0, -220),
        richColors = true,
        background = {
            Brush.linearGradient(
                listOf(
                    MaterialTheme.colorScheme.surfaceColorAtElevation(2.dp),
                    MaterialTheme.colorScheme.surfaceColorAtElevation(2.dp),
                ),
            )
        },
        elevation = 1.dp,
        shadowAmbientColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
        shadowSpotColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
        border = {
            BorderStroke(
                0.dp,
                androidx.compose.ui.graphics.Color.Transparent,
            )
        },
        actionSlot = { toast ->
            (toast.action as? TextToastAction)?.let { action ->
                TextButton(
                    onClick = { action.onClick(toast) },
                    colors =
                        ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.primary,
                        ),
                    modifier = Modifier.fillMaxWidth(.25f),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    Text(
                        text = action.text,
                        fontWeight = FontWeight.Medium,
                        softWrap = true,
                        maxLines = 5,
                    )
                }
            }
        },
        iconSlot = { toast ->
            val statusColors = LocalStatusColors.current
            val (icon, color) =
                (toast.icon as? ImageVector)?.let { it to MaterialTheme.colorScheme.primary }
                    ?: when (toast.type) {
                        ToastType.Success ->
                            Icons.Outlined.CheckCircleOutline to statusColors.success
                        ToastType.Error -> Icons.Outlined.ErrorOutline to statusColors.error
                        ToastType.Warning -> Icons.Outlined.WarningAmber to statusColors.warning
                        ToastType.Info -> Icons.Outlined.Info to MaterialTheme.colorScheme.onSurface
                        ToastType.Normal -> Icons.Outlined.FavoriteBorder to Heart
                    }
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.padding(end = 12.dp),
            )
        },
        contentColor = { MaterialTheme.colorScheme.onSurface },
        shape = { RoundedCornerShape(16.dp) },
        closeButton = { toast ->
            ToastCloseButton(
                onClick = { state.dismiss(toast) },
                modifier = Modifier.align(Alignment.TopEnd),
                offset = DpOffset(8.dp, (-8).dp),
            )
        },
    )
}
