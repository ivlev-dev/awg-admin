package space.ivlev.umbravpn.viewmodel.shared

import android.net.Uri
import com.dokar.sonner.ToastType
import com.wgtunnel.parser.archive.ConfigArchive
import java.io.IOException
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.extensions.asExportFileName
import space.ivlev.umbravpn.util.extensions.asFileExportName

internal class TunnelExportSupport(
    private val fileUtils: FileUtils,
    private val globalEffectRepository: GlobalEffectRepository,
) {
    suspend fun exportGroup(ui: TunnelsUiState, group: TunnelGroup, uri: Uri?) {
        val children = ui.tunnels.filter { it.groupId == group.id }
        if (children.isEmpty()) {
            globalEffectRepository.post(
                GlobalSideEffect.Snackbar(
                    StringValue.StringResource(R.string.no_tunnels_in_group),
                    ToastType.Warning,
                ),
            )
            return
        }
        val (fileName, mimeType) = group.asExportFileName()
        globalEffectRepository.post(
            GlobalSideEffect.ExportFile(
                uri = uri,
                fileName = fileName,
                mimeType = mimeType,
                successMessage = StringValue.StringResource(R.string.export_success),
                prepareFile = { shareFile ->
                    // Always a zip, even for one tunnel, so the group name survives the export
                    fileUtils
                        .writeConfigArchive(shareFile, children.asArchiveEntries())
                        .getOrThrow()
                },
                onComplete = {},
            ),
        )
    }

    suspend fun exportSelected(ui: TunnelsUiState, uri: Uri?, onComplete: () -> Unit) {
        val selectedTunnels = ui.tunnelsForExport
        if (selectedTunnels.isEmpty()) return

        val (fileName, mimeType) = selectedTunnels.asFileExportName()
        globalEffectRepository.post(
            GlobalSideEffect.ExportFile(
                uri = uri,
                fileName = fileName,
                mimeType = mimeType,
                successMessage = StringValue.StringResource(R.string.export_success),
                prepareFile = { shareFile ->
                    if (selectedTunnels.size == 1) {
                        val tunnel = selectedTunnels.first()
                        shareFile.writeText(
                            ConfigArchive.withNameComment(tunnel.quickConfig, tunnel.name),
                        )
                        if (shareFile.length() == 0L) {
                            throw IOException("Failed to create config file")
                        }
                    } else {
                        fileUtils
                            .writeConfigArchive(shareFile, selectedTunnels.asArchiveEntries())
                            .getOrThrow()
                    }
                },
                onComplete = onComplete,
            ),
        )
    }

    private fun Collection<TunnelConfig>.asArchiveEntries(): List<ConfigArchive.Entry> = filter {
        it.quickConfig.isNotBlank()
    }
        .map { ConfigArchive.Entry(it.name, it.quickConfig) }
}
