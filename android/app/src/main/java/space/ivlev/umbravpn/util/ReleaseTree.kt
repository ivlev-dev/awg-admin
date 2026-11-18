package space.ivlev.umbravpn.util

import android.util.Log
import timber.log.Timber

/** Release logging: warnings and errors only, with secrets redacted and no stack traces. */
class ReleaseTree : Timber.Tree() {
    override fun isLoggable(tag: String?, priority: Int): Boolean = priority >= Log.WARN

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        val raw = message.ifBlank {
            t?.let { "${it.javaClass.simpleName}: ${it.message.orEmpty()}" }.orEmpty()
        }
        if (raw.isBlank()) return
        Log.println(priority, tag, LogRedactor.redact(raw))
    }
}
