package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint

@Composable
fun AdminTrafficChart(points: List<AdminTrafficPoint>, modifier: Modifier = Modifier) {
    val rxColor = MaterialTheme.colorScheme.primary
    val txColor = MaterialTheme.colorScheme.tertiary
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)
    Canvas(modifier = modifier) {
        val maxValue =
            points.maxOfOrNull { point -> maxOf(point.rx, point.tx) }?.coerceAtLeast(1L) ?: 1L
        repeat(GRID_LINES) { index ->
            val y = size.height * index / (GRID_LINES - 1)
            drawLine(
                color = gridColor,
                start = Offset(0f, y),
                end = Offset(size.width, y),
                strokeWidth = 1f,
            )
        }
        drawSeries(points.map { it.rx }, maxValue, rxColor)
        drawSeries(points.map { it.tx }, maxValue, txColor)
    }
}

private fun DrawScope.drawSeries(values: List<Long>, maxValue: Long, color: Color) {
    if (values.isEmpty()) return
    if (values.size == 1) {
        val y = size.height - (values.single().toFloat() / maxValue) * size.height
        drawCircle(color = color, radius = 3.dp.toPx(), center = Offset(size.width / 2f, y))
        return
    }
    val step = size.width / (values.size - 1).toFloat()
    val path = Path()
    values.forEachIndexed { index, value ->
        val x = step * index
        val y = size.height - (value.toFloat() / maxValue) * size.height
        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    drawPath(
        path = path,
        color = color,
        style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round),
    )
}

@Composable
fun AdminStatTile(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(text = value, style = MaterialTheme.typography.titleMedium)
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            hint?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

@Composable
fun AdminTrafficLegend(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AdminLegendDot(
            color = MaterialTheme.colorScheme.primary,
            label = stringResource(R.string.admin_stats_rx),
        )
        AdminLegendDot(
            color = MaterialTheme.colorScheme.tertiary,
            label = stringResource(R.string.admin_stats_tx),
        )
    }
}

@Composable
private fun AdminLegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(8.dp).background(color, CircleShape))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}

private const val GRID_LINES = 3
