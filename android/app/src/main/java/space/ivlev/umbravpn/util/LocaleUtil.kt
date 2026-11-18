package space.ivlev.umbravpn.util

import android.os.Build
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import space.ivlev.umbravpn.BuildConfig

object LocaleUtil {
    val supportedLocales: Array<String> = BuildConfig.LANGUAGES
    const val OPTION_PHONE_LANGUAGE = "sys_def"

    val fullyTranslatedTags: Set<String> = LocaleCoverage.fullyTranslatedTags

    fun isFullyTranslated(tag: String): Boolean = LocaleCoverage.isFullyTranslated(tag)

    // Android 13+ persists per-app locales and exposes them in system settings
    val isSystemManaged: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun changeLocale(locale: String) {
        if (locale == OPTION_PHONE_LANGUAGE) return resetToSystemLanguage()
        val appLocale: LocaleListCompat = LocaleListCompat.forLanguageTags(locale)
        AppCompatDelegate.setApplicationLocales(appLocale)
    }

    private fun resetToSystemLanguage() {
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.getEmptyLocaleList())
    }
}
