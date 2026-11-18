package space.ivlev.umbravpn.ui.state

import com.zaneschepke.logcatter.model.LogMessage
import space.ivlev.umbravpn.domain.model.MonitoringSettings

data class IdentifiedLogMessage(val id: Long, val message: LogMessage)

data class LoggerUiState(
    val messages: List<IdentifiedLogMessage> = emptyList(),
    val monitoringSettings: MonitoringSettings = MonitoringSettings(),
    val isLoading: Boolean = true,
)
