package space.ivlev.umbravpn.domain.sideeffect

import android.net.Uri
import com.dokar.sonner.ToastType
import java.io.File
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.util.StringValue

sealed class GlobalSideEffect {

    data class Snackbar(
        val message: StringValue,
        val type: ToastType,
        val actionLabel: String? = null,
        val onAction: (() -> Unit)? = null,
        val durationMs: Long? = null,
    ) : GlobalSideEffect()

    data object PopBackStack : GlobalSideEffect()

    data class LaunchUrl(val url: String) : GlobalSideEffect()

    data class ExportFile(
        val uri: Uri?,
        val fileName: String,
        val mimeType: String,
        val successMessage: StringValue,
        val prepareFile: suspend (File) -> Unit,
        val onComplete: () -> Unit = {},
    ) : GlobalSideEffect()

    data class RequestVpnPermission(val requestingMode: TunnelMode, val config: TunnelConfig?) :
        GlobalSideEffect()

    data class RequestNotificationPermission(val pendingAction: NotificationPendingAction) :
        GlobalSideEffect()

    data class InstallApk(val apk: File) : GlobalSideEffect()
}

sealed class NotificationPendingAction {
    data class StartTunnel(val config: TunnelConfig) : NotificationPendingAction()
}
