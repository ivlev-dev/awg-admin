package space.ivlev.umbravpn.util

object LocaleCoverage {
    const val MINIMUM_FULL_COVERAGE_PERCENT = 90.0

    val fullyTranslatedTags: Set<String> = setOf("en", "ru")

    fun isFullyTranslated(tag: String): Boolean = normalize(tag) in fullyTranslatedTags

    fun normalize(tag: String): String = tag.substringBefore('-').substringBefore('_').lowercase()
}
