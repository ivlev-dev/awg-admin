package space.ivlev.umbravpn.ui.theme

import org.junit.Assert.assertTrue
import org.junit.Test

class StatusContrastTest {

    private val minimumRatio = 4.5

    @Test
    fun lightPaletteMeetsAaContrastOnSurface() {
        assertPalette(StatusPalettes.Light, StatusPalettes.LightSurface)
    }

    @Test
    fun darkPaletteMeetsAaContrastOnSurface() {
        assertPalette(StatusPalettes.Dark, StatusPalettes.DarkSurface)
    }

    @Test
    fun amoledPaletteMeetsAaContrastOnSurface() {
        assertPalette(StatusPalettes.Amoled, StatusPalettes.AmoledSurface)
    }

    @Test
    fun darkPaletteAlsoWorksOnDarkerSurface() {
        assertPalette(StatusPalettes.Dark, 0xFF1C1B1F.toInt())
    }

    @Test
    fun contrastRatioIsSymmetricAndBounded() {
        val black = 0xFF000000.toInt()
        val white = 0xFFFFFFFF.toInt()
        assertTrue(contrastRatio(black, white) == contrastRatio(white, black))
        assertTrue(contrastRatio(black, white) >= 21.0 - 0.001)
        assertTrue(contrastRatio(white, white) == 1.0)
    }

    @Test
    fun relativeLuminanceMatchesKnownValues() {
        assertTrue(relativeLuminance(0xFF000000.toInt()) == 0.0)
        assertTrue(relativeLuminance(0xFFFFFFFF.toInt()) > 0.99)
    }

    @Test
    fun chipTextStillMeetsContrastOnTintedBackground() {
        assertTinted(StatusPalettes.Light, StatusPalettes.LightSurface)
        assertTinted(StatusPalettes.Dark, StatusPalettes.DarkSurface)
        assertTinted(StatusPalettes.Amoled, StatusPalettes.AmoledSurface)
    }

    private fun assertTinted(palette: StatusPalette, surface: Int) {
        val tinted =
            mapOf(
                StatusKind.SUCCESS to blend(palette.success, surface, 0.14),
                StatusKind.WARNING to blend(palette.warning, surface, 0.14),
                StatusKind.ERROR to blend(palette.error, surface, 0.14),
                StatusKind.NEUTRAL to blend(palette.neutral, surface, 0.14),
            )
        tinted.forEach { (kind, background) ->
            val foreground =
                when (kind) {
                    StatusKind.SUCCESS -> palette.success
                    StatusKind.WARNING -> palette.warning
                    StatusKind.ERROR -> palette.error
                    StatusKind.NEUTRAL -> palette.neutral
                }
            val ratio = contrastRatio(foreground, background)
            assertTrue("Tinted $kind contrast $ratio is below $minimumRatio", ratio >= minimumRatio)
        }
    }

    private fun blend(foreground: Int, background: Int, alpha: Double): Int {
        fun channel(shift: Int): Int {
            val fg = (foreground shr shift) and 0xFF
            val bg = (background shr shift) and 0xFF
            return (fg * alpha + bg * (1 - alpha)).toInt().coerceIn(0, 0xFF)
        }
        return (0xFF shl 24) or (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
    }

    private fun assertPalette(palette: StatusPalette, background: Int) {
        palette.contrastAgainst(background).forEach { (kind, ratio) ->
            assertTrue(
                "Status $kind contrast $ratio is below $minimumRatio on surface",
                ratio >= minimumRatio,
            )
        }
    }
}
