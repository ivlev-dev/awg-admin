package space.ivlev.umbravpn.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import com.dokar.sonner.ToastType
import com.zaneschepke.logcatter.LogReader
import java.time.Instant
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.sample
import org.orbitmvi.orbit.OrbitContainerHost
import org.orbitmvi.orbit.viewmodel.orbitContainer
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.ui.state.IdentifiedLogMessage
import space.ivlev.umbravpn.ui.state.LoggerUiState
import space.ivlev.umbravpn.util.Constants
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.extensions.toUserFriendlyTimestamp

class LoggerViewModel(
    private val logReader: LogReader,
    private val globalEffectRepository: GlobalEffectRepository,
) : OrbitContainerHost<LoggerUiState, LoggerUiState, Nothing>, ViewModel() {

    // accumulator shared between the producer and sampler coroutines of the batching pipeline
    private val logBuffer = ArrayDeque<IdentifiedLogMessage>()
    private var nextLogId = 0L

    @OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
    override val container =
        orbitContainer<LoggerUiState, Nothing>(
            LoggerUiState(),
            buildSettings = { repeatOnSubscribedStopTimeout = 5000L },
        ) {
            intent {
                logReader.bufferedLogs
                    .onEach { logMessage ->
                        synchronized(logBuffer) {
                            if (logBuffer.size >= MAX_LOG_SIZE) logBuffer.removeFirst()
                            logBuffer.addLast(IdentifiedLogMessage(nextLogId++, logMessage))
                        }
                    }
                    .sample(BATCH_INTERVAL)
                    .collect {
                        val snapshot = synchronized(logBuffer) { logBuffer.toList() }
                        reduce { state.copy(messages = snapshot, isLoading = false) }
                    }
            }
            intent {
                delay(300.milliseconds)
                if (state.isLoading) {
                    reduce { state.copy(isLoading = false) }
                }
            }
        }

    suspend fun postSideEffect(globalSideEffect: GlobalSideEffect) {
        globalEffectRepository.post(globalSideEffect)
    }

    fun exportLogs(uri: Uri?) = intent {
        val timestamp = Instant.now().toUserFriendlyTimestamp()
        postSideEffect(
            GlobalSideEffect.ExportFile(
                uri = uri,
                fileName =
                    "${Constants.BASE_LOG_FILE_NAME}_${timestamp}_${BuildConfig.VERSION_NAME}_${BuildConfig.FLAVOR}.zip",
                mimeType = FileUtils.ZIP_FILE_MIME_TYPE,
                successMessage = StringValue.StringResource(R.string.log_export_success),
                prepareFile = { file -> logReader.zipLogFiles(file.absolutePath) },
            ),
        )
    }

    fun deleteLogs() = intent {
        synchronized(logBuffer) { logBuffer.clear() }
        reduce { state.copy(messages = emptyList()) }
        logReader.deleteAndClearLogs()
        postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(R.string.stored_logs_deleted),
                ToastType.Success,
            ),
        )
    }

    companion object {
        const val MAX_LOG_SIZE = 10_000L
        private val BATCH_INTERVAL = 200.milliseconds
    }
}
