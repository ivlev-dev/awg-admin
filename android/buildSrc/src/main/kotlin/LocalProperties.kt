import java.io.File
import java.io.FileInputStream
import java.util.Properties

object LocalProperties {

    private val cache = mutableMapOf<File, Properties>()

    fun get(key: String, rootDir: File = File(".")): String? =
        properties(rootDir).getProperty(key)?.takeIf { it.isNotBlank() }

    fun getOrDefault(key: String, default: String, rootDir: File = File(".")): String =
        get(key, rootDir) ?: default

    private fun properties(rootDir: File): Properties {
        val directory = rootDir.absoluteFile.normalize()
        return cache.getOrPut(directory) {
            val props = Properties()
            val file = File(directory, "local.properties")
            if (file.exists()) {
                FileInputStream(file).use { props.load(it) }
            }
            props
        }
    }
}
