package space.ivlev.umbravpn.util

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import com.wgtunnel.parser.archive.ConfigArchive
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import timber.log.Timber

class FileUtils(private val context: Context, private val ioDispatcher: CoroutineDispatcher) {

    /**
     * Writes [entries] as a zip of `.conf` files to [zipFile], replacing it.
     *
     * @return Result.success(Unit) on success, or Result.failure with the exception on error.
     */
    suspend fun writeConfigArchive(
        zipFile: File,
        entries: List<ConfigArchive.Entry>,
    ): Result<Unit> =
        withContext(ioDispatcher) {
            runCatching {
                BufferedOutputStream(FileOutputStream(zipFile)).use { out ->
                    ConfigArchive.write(out, entries)
                }
                Timber.d(
                    "Wrote ${entries.size} configs to ${zipFile.path}, size: ${zipFile.length()} bytes",
                )
            }
                .onFailure { error ->
                    Timber.e(error, "Error zipping configs into ${zipFile.path}")
                    if (zipFile.exists()) zipFile.delete()
                }
        }

    suspend fun createNewShareFile(name: String): Result<File> =
        withContext(ioDispatcher) {
            runCatching {
                val cacheDir = context.cacheDir ?: throw IOException("Cache directory unavailable")
                val sharePath = File(cacheDir, "external_files")
                if (!sharePath.exists() && !sharePath.mkdirs()) {
                    throw IOException("Failed to create share directory: ${sharePath.path}")
                }
                val file = File(sharePath, sanitizeFileName(name))
                if (file.exists() && !file.delete()) {
                    throw IOException("Failed to delete existing file: ${file.path}")
                }
                if (!file.createNewFile()) {
                    throw IOException("Failed to create new file: ${file.path}")
                }
                Timber.d("Created share file: ${file.path}")
                file
            }
                .onFailure { error -> Timber.e(error, "Error creating share file") }
        }

    suspend fun exportFile(file: File, uri: Uri?, mimeType: String): Result<Uri> {
        return if (uri != null) {
            copyFileToUri(file, uri).map { uri }
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                runCatching {
                    saveToDownloadsWithMediaStore(file, mimeType)
                        ?: throw IOException("Failed to insert into MediaStore")
                }
            } else {
                // Android 8, 9 and Android TV
                saveToDownloadsLegacy(file, mimeType)
            }
        }
    }

    private suspend fun saveToDownloadsLegacy(file: File, mimeType: String): Result<Uri> =
        withContext(ioDispatcher) {
            runCatching {
                val downloadsDir =
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
                    throw IOException("Cannot access Downloads directory")
                }

                val dest = File(downloadsDir, file.name)
                file.inputStream().use { input ->
                    FileOutputStream(dest).use { output -> input.copyTo(output) }
                }

                // Make it visible to file managers
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(dest.absolutePath),
                    arrayOf(mimeType),
                    null,
                )

                Uri.fromFile(dest)
            }
        }

    suspend fun copyFileToUri(sourceFile: File, destinationUri: Uri): Result<Unit> =
        withContext(ioDispatcher) {
            try {
                if (!sourceFile.exists()) {
                    Timber.e("Source file does not exist: ${sourceFile.path}")
                    return@withContext Result.failure(IOException("Source file does not exist"))
                }
                if (!sourceFile.canRead()) {
                    Timber.e("Source file is not readable: ${sourceFile.path}")
                    return@withContext Result.failure(IOException("Source file is not readable"))
                }
                if (sourceFile.length() == 0L) {
                    Timber.e("Source file is empty: ${sourceFile.path}")
                    return@withContext Result.failure(IOException("Source file is empty"))
                }

                Timber.d("Copying file: ${sourceFile.path}, size: ${sourceFile.length()} bytes")
                var bytesCopied = 0L
                FileInputStream(sourceFile).use { inputStream ->
                    context.contentResolver.openOutputStream(destinationUri)?.use { outputStream ->
                        val buffer = ByteArray(1024 * 1024) // 1MB buffer
                        var bytesRead: Int
                        while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                            outputStream.write(buffer, 0, bytesRead)
                            bytesCopied += bytesRead
                            Timber.d("Copied $bytesCopied bytes so far")
                        }
                        outputStream.flush()
                        Timber.d("Total bytes copied: $bytesCopied")
                        Result.success(Unit)
                    }
                        ?: run {
                            Timber.e("Failed to open OutputStream for Uri: $destinationUri")
                            Result.failure(IOException("Failed to open OutputStream for Uri"))
                        }
                }
            } catch (e: IOException) {
                Timber.e(e, "Error copying file to Uri: ${e.message}")
                Result.failure(e)
            }
        }

    /**
     * Strips characters that are illegal in a file name on Android (like /) Falls back to a generic
     * name if nothing is left.
     */
    private fun sanitizeFileName(name: String): String {
        val cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "_").trim(' ', '.')
        return cleaned.ifBlank { "tunnel" }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    suspend fun saveToDownloadsWithMediaStore(file: File, mimeType: String): Uri? =
        withContext(ioDispatcher) {
            val contentValues =
                ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, file.name)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }

            val resolver = context.contentResolver
            val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val itemUri = resolver.insert(collection, contentValues) ?: return@withContext null

            resolver.openOutputStream(itemUri)?.use { output ->
                file.inputStream().use { input -> input.copyTo(output) }
            }
            // Mark as finished
            contentValues.clear()
            contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(itemUri, contentValues, null, null)

            return@withContext itemUri
        }

    companion object {
        const val TEXT_MIME_TYPE = "text/plain"
        const val ZIP_FILE_MIME_TYPE = "application/zip"
        const val OCTET_STREAM_MIME_TYPE = "application/octet-stream"
        const val ALL_FILE_TYPES = "*/*"
        val TV_IMPORT_MIME_TYPES =
            arrayOf(TEXT_MIME_TYPE, ZIP_FILE_MIME_TYPE, OCTET_STREAM_MIME_TYPE)

        const val GOOGLE_TV_EXPLORER_STUB = "com.google.android.tv.frameworkpackagestubs"
        const val ANDROID_TV_EXPLORER_STUB = "com.android.tv.frameworkpackagestubs"

        private val ILLEGAL_FILENAME_CHARS = Regex("[/\\\\:*?\"<>|]")
    }
}
