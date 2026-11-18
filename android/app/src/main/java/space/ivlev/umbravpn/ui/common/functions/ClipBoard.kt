package space.ivlev.umbravpn.ui.common.functions

import android.content.ClipData
import android.os.PersistableBundle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A copied secret is cleared after this delay unless the clipboard content changed meanwhile. */
internal const val SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS = 45_000L

internal object ClipboardAutoClear {
    fun shouldClear(copied: String, current: String?): Boolean =
        current != null && current == copied
}

class ClipboardHelper(
    private val clipboard: Clipboard,
    private val coroutineScope: CoroutineScope,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Main,
    private val clearDelayMs: Long = SENSITIVE_CLIPBOARD_CLEAR_DELAY_MS,
) {
    private var clearJob: Job? = null

    fun copy(text: String, label: String = "", sensitive: Boolean = false) {
        clearJob?.cancel()
        coroutineScope.launch(dispatcher) {
            val clipData = ClipData.newPlainText(label, text)
            if (sensitive) clipData.markSensitive()
            clipboard.setClipEntry(ClipEntry(clipData))
            if (sensitive) {
                clearJob =
                    coroutineScope.launch(dispatcher) {
                        delay(clearDelayMs)
                        clearIfUnchanged(text)
                    }
            }
        }
    }

    fun paste(onResult: (String?) -> Unit) {
        coroutineScope.launch(dispatcher) {
            val entry = clipboard.getClipEntry()
            val text = entry?.clipData?.getItemAt(0)?.text?.toString()
            onResult(text)
        }
    }

    private suspend fun clearIfUnchanged(copied: String) {
        val current = clipboard.getClipEntry()?.clipData?.getItemAt(0)?.text?.toString()
        if (ClipboardAutoClear.shouldClear(copied, current)) {
            clipboard.setClipEntry(null)
        }
    }
}

private fun ClipData.markSensitive() {
    // ClipDescription.EXTRA_IS_SENSITIVE is only exposed since API 33; the key itself is stable.
    description.extras = PersistableBundle().apply { putBoolean(EXTRA_IS_SENSITIVE_KEY, true) }
}

private const val EXTRA_IS_SENSITIVE_KEY: String = "android.content.extra.IS_SENSITIVE"

@Composable
fun rememberClipboardHelper(
    coroutineScope: CoroutineScope = rememberCoroutineScope(),
): ClipboardHelper {
    val clipboard = LocalClipboard.current
    return remember(clipboard, coroutineScope) { ClipboardHelper(clipboard, coroutineScope) }
}
