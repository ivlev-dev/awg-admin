package space.ivlev.umbravpn.data.sync

private val TRAILING_INDEX = Regex("^(.*?)\\s*\\((\\d+)\\)$")

internal fun uniqueTunnelName(candidate: String, usedNames: Collection<String>): String {
    val base = candidate.trim().ifEmpty { DEFAULT_DEVICE_NAME }
    if (base !in usedNames) return base

    val stem =
        TRAILING_INDEX.find(base)?.groupValues?.get(1)?.trimEnd()?.takeIf { it.isNotEmpty() }
            ?: base
    var counter = 2
    var name = "$stem ($counter)"
    while (name in usedNames) {
        counter++
        name = "$stem ($counter)"
    }
    return name
}
