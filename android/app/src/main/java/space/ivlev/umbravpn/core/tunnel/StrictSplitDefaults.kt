package space.ivlev.umbravpn.core.tunnel

import android.content.Context
import android.os.Build
import com.wgtunnel.parser.Config
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import space.ivlev.umbravpn.domain.enums.StrictSplitNotice
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.GeneralSettings
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.util.RussiaHint
import space.ivlev.umbravpn.util.russiaHint

/** Decides strict split tunneling for users in Russia. */
class StrictSplitDefaults(
    private val context: Context,
    private val settingsRepository: GeneralSettingRepository,
    private val appStateRepository: AppStateRepository,
) {
    val notice: Flow<StrictSplitNotice?> = appStateRepository.strictSplitNotice

    suspend fun beforeStart(settings: GeneralSettings, runConfig: Config): GeneralSettings {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                settings.tunnelMode != TunnelMode.VPN ||
                settings.strictSplitTunnelEnabled ||
                !runConfig.leavesAppsOff() ||
                appStateRepository.isStrictSplitDecided() ||
                appStateRepository.strictSplitNotice.first() != null
        ) {
            return settings
        }
        return when (context.russiaHint()) {
            RussiaHint.TELEPHONY -> {
                appStateRepository.setStrictSplitDecided(true)
                val enabled = settings.copy(strictSplitTunnelEnabled = true)
                settingsRepository.upsert(enabled)
                appStateRepository.setStrictSplitNotice(StrictSplitNotice.ENABLED)
                enabled
            }
            RussiaHint.LOCALE -> {
                appStateRepository.setStrictSplitNotice(StrictSplitNotice.SUGGESTED)
                settings
            }
            RussiaHint.NONE -> settings
        }
    }

    suspend fun acknowledge() {
        appStateRepository.setStrictSplitNotice(null)
    }

    suspend fun answer(enable: Boolean) {
        appStateRepository.setStrictSplitDecided(true)
        appStateRepository.setStrictSplitNotice(null)
        if (enable) {
            val settings = settingsRepository.flow.first()
            settingsRepository.upsert(settings.copy(strictSplitTunnelEnabled = true))
            settingsRepository.flow.first { it.strictSplitTunnelEnabled }
        }
    }

    private fun Config.leavesAppsOff(): Boolean =
        `interface`.allIncludedApps.isNotEmpty() || `interface`.allExcludedApps.isNotEmpty()
}
