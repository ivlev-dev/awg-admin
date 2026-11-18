package space.ivlev.umbravpn.core.orchestration

import android.content.Context
import com.zaneschepke.logcatter.LogReader
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import space.ivlev.umbravpn.core.tunnel.TunnelProvider
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.repository.DnsSettingsRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.LockdownSettingsRepository
import space.ivlev.umbravpn.domain.repository.MonitoringSettingsRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.service.tile.TunnelTileRefresher
import timber.log.Timber

class AppBoostrapCoordinator(
    private val monitoringRepository: MonitoringSettingsRepository,
    private val settingsRepository: GeneralSettingRepository,
    private val dnsRepository: DnsSettingsRepository,
    private val tunnelRepository: TunnelRepository,
    private val lockdownRepository: LockdownSettingsRepository,
    private val tunnelProvider: TunnelProvider,
    private val dnsSettingsCoordinator: DnsSettingsCoordinator,
    private val logReader: LogReader,
) {

    private val _isReady = MutableStateFlow(false)
    val isReady: StateFlow<Boolean> = _isReady.asStateFlow()

    suspend fun bootstrap(context: Context) = coroutineScope {
        launch { bootstrapLogging() }

        val criticalTasks =
            listOf(
                async { bootstrapDns() },
                async { ensureGlobalConfig() },
                async { restoreBackendConfiguration() },
            )

        try {
            criticalTasks.awaitAll()
            _isReady.value = true
            Timber.d("App bootstrap completed successfully")
        } catch (e: Exception) {
            Timber.e(e, "One or more critical bootstrap tasks failed")
            _isReady.value = true
        } finally {
            TunnelTileRefresher.refresh(context)
        }
    }

    private suspend fun bootstrapDns() {
        val dnsSettings = dnsRepository.getDnsSettings()
        dnsSettingsCoordinator.appyDnsSettings(dnsSettings)
    }

    private suspend fun bootstrapLogging() {
        monitoringRepository.flow
            .distinctUntilChangedBy { it.isLocalLogsEnabled }
            .collect { settings ->
                if (settings.isLocalLogsEnabled) {
                    logReader.start()
                } else {
                    logReader.stop()
                }
            }
    }

    private suspend fun ensureGlobalConfig() {
        tunnelRepository.ensureGlobalConfigExists()
    }

    private suspend fun restoreBackendConfiguration() {
        val settings = settingsRepository.getGeneralSettings()

        when (settings.tunnelMode) {
            TunnelMode.LOCK_DOWN -> {
                val lockdownSettings = lockdownRepository.getLockdownSettings()
                tunnelProvider.setLockDown(lockdownSettings).onFailure {
                    Timber.w(it, "Failed to restore lockdown/kill-switch on startup")
                }
            }
            else -> Unit
        }
    }
}
