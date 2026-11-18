package space.ivlev.umbravpn.util.logging

import com.zaneschepke.logcatter.LogReader
import com.zaneschepke.logcatter.model.LogMessage
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * Release builds do not run logcat: reading the process log would capture whatever the backend
 * prints, including keys. Logcat is only collected in debug builds (or a future explicit diagnostic
 * mode).
 */
class NoopLogReader : LogReader {
    override suspend fun start() = Unit

    override suspend fun stop() = Unit

    override suspend fun zipLogFiles(path: String) {
        runCatching {
            ZipOutputStream(FileOutputStream(path)).use { zip ->
                zip.putNextEntry(ZipEntry("README.txt"))
                zip.write("Diagnostic logging is disabled in release builds.\n".encodeToByteArray())
                zip.closeEntry()
            }
        }
    }

    override suspend fun deleteAndClearLogs() = Unit

    override suspend fun clearBufferedLogs() = Unit

    override val bufferedLogs: Flow<LogMessage> = emptyFlow()
}
