import java.io.File
import org.gradle.api.Project

data class ReleaseSigning(
    val storeFile: File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

data class ReleaseSigningState(
    val signing: ReleaseSigning?,
    val storeFile: File,
    val missing: List<String>,
) {
    val isConfigured: Boolean
        get() = signing != null

    fun errorMessage(): String = buildString {
        appendLine("Release signing is not configured, refusing to build an unsigned release.")
        appendLine("Missing: ${missing.joinToString(", ")}.")
        appendLine("Provide the values through environment variables or android/local.properties:")
        appendLine("  KEY_STORE_PATH=/absolute/path/to/release.jks")
        appendLine("  SIGNING_STORE_PASSWORD=...")
        appendLine("  SIGNING_KEY_ALIAS=...")
        appendLine("  SIGNING_KEY_PASSWORD=...")
        appendLine("Create a keystore with scripts/generate-keystore.sh.")
        appendLine("In CI set ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,")
        appendLine("ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD.")
        append("See docs/ANDROID.md, section \"Подпись и релиз\".")
    }
}

object AndroidSigning {

    private const val DEFAULT_STORE_FILE = "keystore/umbravpn-release.jks"
    private const val LEGACY_STORE_FILE = "app/keystore/android_keystore.jks"

    private val STORE_PATH_KEYS = listOf("KEY_STORE_PATH", "ANDROID_KEYSTORE_PATH")
    private val STORE_PASSWORD_KEYS = listOf("SIGNING_STORE_PASSWORD", "ANDROID_KEYSTORE_PASSWORD")
    private val KEY_ALIAS_KEYS = listOf("SIGNING_KEY_ALIAS", "ANDROID_KEY_ALIAS")
    private val KEY_PASSWORD_KEYS = listOf("SIGNING_KEY_PASSWORD", "ANDROID_KEY_PASSWORD")

    fun resolve(project: Project): ReleaseSigningState {
        val rootDir = project.rootDir
        val configuredPath = findValue(project, STORE_PATH_KEYS)
        val storePassword = findValue(project, STORE_PASSWORD_KEYS)
        val keyAlias = findValue(project, KEY_ALIAS_KEYS)
        val keyPassword = findValue(project, KEY_PASSWORD_KEYS)

        val storeFile =
            when {
                configuredPath != null -> resolveStoreFile(rootDir, configuredPath)
                File(rootDir, DEFAULT_STORE_FILE).isFile -> File(rootDir, DEFAULT_STORE_FILE)
                File(rootDir, LEGACY_STORE_FILE).isFile -> File(rootDir, LEGACY_STORE_FILE)
                else -> File(rootDir, DEFAULT_STORE_FILE)
            }

        val missing = buildList {
            if (storePassword == null) add(STORE_PASSWORD_KEYS.first())
            if (keyAlias == null) add(KEY_ALIAS_KEYS.first())
            if (keyPassword == null) add(KEY_PASSWORD_KEYS.first())
            if (!storeFile.isFile) {
                add("keystore file at ${storeFile.path} (${STORE_PATH_KEYS.first()})")
            }
        }

        val signing =
            if (
                storePassword != null && keyAlias != null && keyPassword != null && storeFile.isFile
            ) {
                ReleaseSigning(
                    storeFile = storeFile,
                    storePassword = storePassword,
                    keyAlias = keyAlias,
                    keyPassword = keyPassword,
                )
            } else {
                null
            }

        return ReleaseSigningState(signing = signing, storeFile = storeFile, missing = missing)
    }

    private fun resolveStoreFile(rootDir: File, path: String): File {
        val candidate = File(path)
        return if (candidate.isAbsolute) candidate else File(rootDir, path)
    }

    private fun findValue(project: Project, keys: List<String>): String? {
        keys.forEach { key ->
            val envValue = project.providers.environmentVariable(key).orNull?.trim()
            if (!envValue.isNullOrEmpty()) return envValue
        }
        keys.forEach { key ->
            LocalProperties.get(key, project.rootDir)?.let {
                return it
            }
        }
        return null
    }
}
