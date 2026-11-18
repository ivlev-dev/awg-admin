package space.ivlev.umbravpn.localization

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import space.ivlev.umbravpn.util.LocaleCoverage

class LocalizationParityTest {

    private val resDir = resolveResDir()

    @Test
    fun russianLocaleHasEveryBaseKey() {
        val base = keys(resFile("values"))
        val ru = keys(resFile("values-ru"))

        val missing = base - ru
        assertTrue("Missing Russian strings: ${missing.sorted()}", missing.isEmpty())
        assertTrue(
            "Russian has keys absent from base: ${(ru - base).sorted()}",
            (ru - base).isEmpty(),
        )
    }

    @Test
    fun russianHasFullPluralSetForAppCounts() {
        val plurals = plurals(resFile("values-ru"))

        assertEquals(
            setOf("one", "few", "many", "other"),
            plurals["apps_tunneled"]?.toSet(),
        )
        assertEquals(
            setOf("one", "few", "many", "other"),
            plurals["apps_bypassed"]?.toSet(),
        )
    }

    @Test
    fun fullyTranslatedLocalesMatchTranslationCoverage() {
        val base = keys(resFile("values"))
        val coverage = localeCoverage(base)
        val fullyTranslated =
            coverage.filterValues { it >= LocaleCoverage.MINIMUM_FULL_COVERAGE_PERCENT }.keys

        assertEquals(LocaleCoverage.fullyTranslatedTags, fullyTranslated)
        assertTrue(coverage.getValue("ru") >= 95.0)
    }

    private fun keys(file: File): Set<String> {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = document.documentElement.childNodes
        val result = mutableSetOf<String>()
        for (index in 0 until nodes.length) {
            val element = nodes.item(index) as? Element ?: continue
            if (element.tagName == "string" || element.tagName == "plurals") {
                result += "${element.tagName}:${element.getAttribute("name")}"
            }
        }
        return result
    }

    private fun plurals(file: File): Map<String, List<String>> {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = document.documentElement.childNodes
        val result = mutableMapOf<String, List<String>>()
        for (index in 0 until nodes.length) {
            val element = nodes.item(index) as? Element ?: continue
            if (element.tagName != "plurals") continue
            val items = mutableListOf<String>()
            val children = element.childNodes
            for (childIndex in 0 until children.length) {
                val item = children.item(childIndex) as? Element ?: continue
                if (item.tagName == "item") items += item.getAttribute("quantity")
            }
            result[element.getAttribute("name")] = items
        }
        return result
    }

    private fun localeCoverage(base: Set<String>): Map<String, Double> {
        val locales = resDir.listFiles().orEmpty().filter { it.isDirectory && it.name != "values" }
        val coverage =
            locales
                .mapNotNull { dir ->
                    val file = File(dir, "strings.xml")
                    if (!file.exists()) return@mapNotNull null
                    val tag = dir.name.removePrefix("values-").replace("-r", "-").lowercase()
                    val percent = keys(file).count { it in base }.toDouble() / base.size * 100.0
                    LocaleCoverage.normalize(tag) to percent
                }
                .groupBy({ it.first }, { it.second })
                .mapValues { (_, values) -> values.max() }
        return coverage + ("en" to 100.0)
    }

    private fun resFile(dir: String): File {
        val file = File(resDir, "$dir/strings.xml")
        assertTrue("Missing resource file $file", file.exists())
        return file
    }

    private fun resolveResDir(): File {
        val candidates =
            listOf(
                File("src/main/res"),
                File("app/src/main/res"),
                File("../app/src/main/res"),
            )
        return candidates.firstOrNull { File(it, "values/strings.xml").exists() }
            ?: error("Could not locate Android resources from ${File(".").absolutePath}")
    }
}
