package space.ivlev.umbravpn.ui.theme

import androidx.compose.ui.graphics.Color

// Umbra brand palette
val UmbraBlue = Color(0xFF0E4688)
val UmbraBlueLight = Color(0xFFCDDDFF)
val UmbraInk = Color(0xFF0E1A2B)
val UmbraMist = Color(0xFFF2F5F9)
val UmbraBlueSoft = Color(0xFFA8C7FA)
val UmbraSlate = Color(0xFF16243A)
val UmbraOutline = Color(0xFF75777D)
val UmbraOutlineDark = Color(0xFF8E8F96)

val OffWhite = Color(0xFFF2F2F4)
val CoolGray = Color(0xFF8D9D9F)
val LightGrey = Color(0xFFECEDEF)
val Aqua = Color(0xFF76BEBD)
val Plantation = Color(0xFF2E3538)
val Shark = Color(0xFF21272A)
val BalticSea = Color(0xFF1C1B1F)

// amoled
val ElectricTeal = Color(0xFF4DD0E1)

// Status colors
val SilverTree = Color(0xFF6DB58B)
val AlertRed = Color(0xFFCF6679)
val Straw = Color(0xFFD4C483)

val Disabled = CoolGray.copy(alpha = 0.4f)

// Other colors
val ConfigHeaderColor = Color(0xFFBB86FC)
val ConfigKeyColor = Color(0xFF03DAC5)
val Heart = Color(0xFFDB61A2)

sealed class ThemeColors(
    val background: Color,
    val surface: Color,
    val primary: Color,
    val onPrimary: Color,
    val primaryContainer: Color,
    val onPrimaryContainer: Color,
    val secondary: Color,
    val onSurface: Color,
    val onBackground: Color,
    val outline: Color,
) {

    data object Light :
        ThemeColors(
            background = UmbraMist,
            surface = Color(0xFFFFFFFF),
            primary = UmbraBlue,
            onPrimary = Color(0xFFFFFFFF),
            primaryContainer = UmbraBlueLight,
            onPrimaryContainer = Color(0xFF001738),
            secondary = Color(0xFF3F4756),
            onSurface = UmbraInk,
            outline = UmbraOutline,
            onBackground = UmbraInk,
        )

    data object Dark :
        ThemeColors(
            background = UmbraInk,
            surface = UmbraSlate,
            primary = UmbraBlueSoft,
            onPrimary = Color(0xFF003063),
            primaryContainer = UmbraBlue,
            onPrimaryContainer = UmbraBlueLight,
            secondary = Color(0xFFBEC6D8),
            onSurface = UmbraMist,
            outline = UmbraOutlineDark,
            onBackground = UmbraMist,
        )
}
