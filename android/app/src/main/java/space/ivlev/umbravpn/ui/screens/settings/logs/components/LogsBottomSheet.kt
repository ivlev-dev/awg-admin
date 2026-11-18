package space.ivlev.umbravpn.ui.screens.settings.logs.components

import android.net.Uri
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import java.time.Instant
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.functions.rememberFileExportLauncherForResult
import space.ivlev.umbravpn.ui.common.sheet.CustomBottomSheet
import space.ivlev.umbravpn.ui.common.sheet.SheetOption
import space.ivlev.umbravpn.util.Constants
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.extensions.hasSAFSupport
import space.ivlev.umbravpn.util.extensions.toUserFriendlyTimestamp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsBottomSheet(
    onExport: (Uri?) -> Unit,
    onDelete: () -> Unit,
    onCanceled: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    val exportLauncher =
        rememberFileExportLauncherForResult(
            mimeType = FileUtils.ZIP_FILE_MIME_TYPE,
            onSuccess = { uri -> onExport(uri) },
            onCanceled = onCanceled,
            onUnsupported = { onExport(null) },
        )

    fun handleFileExport() {
        if (context.hasSAFSupport(FileUtils.ZIP_FILE_MIME_TYPE)) {
            val timestamp = Instant.now().toUserFriendlyTimestamp()
            val fileName =
                "${Constants.BASE_LOG_FILE_NAME}_${timestamp}_${BuildConfig.VERSION_NAME}_${BuildConfig.FLAVOR}.zip"

            exportLauncher.launch(fileName)
        } else {
            onExport(null)
        }
    }

    CustomBottomSheet(
        listOf(
            SheetOption(
                Icons.Outlined.FolderZip,
                stringResource(R.string.export_logs),
                onClick = { handleFileExport() },
            ),
            SheetOption(
                Icons.Outlined.Delete,
                stringResource(R.string.delete_logs),
                onClick = onDelete,
            ),
        ),
    ) {
        onDismiss()
    }
}
