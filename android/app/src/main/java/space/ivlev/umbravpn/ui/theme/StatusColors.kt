package space.ivlev.umbravpn.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

enum class StatusKind {
    SUCCESS,
    WARNING,
    ERROR,
    NEUTRAL,
}

@Immutable
data class StatusPalette(
    val success: Int,
    val warning: Int,
    val error: Int,
    val neutral: Int,
)

object StatusPalettes {
    val Light =
        StatusPalette(
            success = 0xFF16663A.toInt(),
            warning = 0xFF7A4E00.toInt(),
            error = 0xFFA3162B.toInt(),
            neutral = 0xFF4A4F57.toInt(),
        )

    val Dark =
        StatusPalette(
            success = 0xFF7FD8A5.toInt(),
            warning = 0xFFFFD479.toInt(),
            error = 0xFFFF9AA8.toInt(),
            neutral = 0xFFBFC6D4.toInt(),
        )

    val Amoled = Dark

    val LightSurface = 0xFFFFFFFF.toInt()
    val DarkSurface = 0xFF16243A.toInt()
    val AmoledSurface = 0xFF000000.toInt()
}

@Immutable
data class StatusColors(
    val success: Color,
    val warning: Color,
    val error: Color,
    val neutral: Color,
) {
    fun colorFor(kind: StatusKind): Color =
        when (kind) {
            StatusKind.SUCCESS -> success
            StatusKind.WARNING -> warning
            StatusKind.ERROR -> error
            StatusKind.NEUTRAL -> neutral
        }

    companion object {
        fun from(palette: StatusPalette): StatusColors =
            StatusColors(
                success = Color(palette.success),
                warning = Color(palette.warning),
                error = Color(palette.error),
                neutral = Color(palette.neutral),
            )
    }
}

val LocalStatusColors = compositionLocalOf { StatusColors.from(StatusPalettes.Light) }

private const val SRGB_GAMMA_THRESHOLD = 0.03928
private const val SRGB_OFFSET = 0.055
private const val SRGB_DIVISOR = 1.055
private const val SRGB_GAMMA = 2.4

fun relativeLuminance(argb: Int): Double {
    val red = ((argb shr 16) and 0xFF) / 255.0
    val green = ((argb shr 8) and 0xFF) / 255.0
    val blue = (argb and 0xFF) / 255.0
    fun channel(value: Double): Double =
        if (value <= SRGB_GAMMA_THRESHOLD) {
            value / 12.92
        } else {
            Math.pow((value + SRGB_OFFSET) / SRGB_DIVISOR, SRGB_GAMMA)
        }
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

fun contrastRatio(foreground: Int, background: Int): Double {
    val first = relativeLuminance(foreground)
    val second = relativeLuminance(background)
    val lighter = maxOf(first, second)
    val darker = minOf(first, second)
    return (lighter + 0.05) / (darker + 0.05)
}

fun StatusPalette.contrastAgainst(background: Int): Map<StatusKind, Double> =
    mapOf(
        StatusKind.SUCCESS to contrastRatio(success, background),
        StatusKind.WARNING to contrastRatio(warning, background),
        StatusKind.ERROR to contrastRatio(error, background),
        StatusKind.NEUTRAL to contrastRatio(neutral, background),
    )
