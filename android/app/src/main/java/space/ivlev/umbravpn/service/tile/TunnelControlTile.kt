package space.ivlev.umbravpn.service.tile

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.wgtunnel.backend.state.ActiveTunnel
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.koin.android.ext.android.inject
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.lock.PinGateActivity
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.ui.state.DisplayTunnelState

class TunnelControlTile : TileService() {

    private val tunnelsRepository: TunnelRepository by inject()
    private val tunnelCoordinator: TunnelCoordinator by inject()

    private val appLockManager: AppLockManager by inject()

    private val tileScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onDestroy() {
        tileScope.cancel()
        super.onDestroy()
    }

    override fun onTileAdded() {
        super.onTileAdded()
        updateTileState()
    }

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        unlockAndRun {
            tileScope.launch {
                if (appLockManager.isLockRequired()) {
                    startPinGate(PinGateActivity.Action.TOGGLE_TUNNELS)
                    return@launch
                }
                tunnelCoordinator.toggleActiveTunnels()
                updateTileState()
            }
        }
    }

    private fun updateTileState() {
        tileScope.launch {
            val tunnels =
                withContext(Dispatchers.IO) { tunnelsRepository.userTunnelsFlow.firstOrNull() }

            if (tunnels.isNullOrEmpty()) {
                setUnavailable()
                return@launch
            }

            val active = tunnelCoordinator.backendStatus.value.activeTunnels

            if (active.isNotEmpty()) {
                val activeConfigs = tunnels.filter { active.containsKey(it.id) }
                setActive(activeConfigs, tunnels, active)
            } else {
                setInactive()
            }
        }
    }

    private fun setActive(
        activeConfigs: List<TunnelConfig>,
        allTunnels: List<TunnelConfig>,
        active: Map<Int, ActiveTunnel>,
    ) {
        val context = this
        qsTile?.apply {
            state = Tile.STATE_ACTIVE

            when (activeConfigs.size) {
                1 -> {
                    val tunnel = activeConfigs.first()
                    val activeTunnel = active.getValue(tunnel.id)
                    val state = DisplayTunnelState.from(activeTunnel).asLocalizedString(context)
                    val viaName =
                        tunnel.entryTunnelId?.let { id ->
                            allTunnels.firstOrNull { it.id == id }?.name
                        }

                    label = tunnel.name
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        subtitle =
                            if (viaName != null) getString(R.string.via_entry, viaName) else state
                    }
                    contentDescription =
                        if (viaName != null) {
                            "${tunnel.name} • ${getString(R.string.via_entry, viaName)} • $state"
                        } else {
                            "${tunnel.name} • $state"
                        }
                }

                else -> {
                    val tunnelsLabel = getString(R.string.tunnels).lowercase(Locale.getDefault())
                    label = "${activeConfigs.size} $tunnelsLabel"
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        subtitle = ""
                    }
                    contentDescription = "${activeConfigs.size} $tunnelsLabel"
                }
            }
            updateTile()
        }
    }

    private fun setInactive() {
        qsTile?.apply {
            state = Tile.STATE_INACTIVE

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = ""
            }
            contentDescription = ""

            updateTile()
        }
    }

    private fun setUnavailable() {
        qsTile?.apply {
            label = getString(R.string.tunnel_control)
            state = Tile.STATE_UNAVAILABLE

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = ""
            }
            contentDescription = ""

            updateTile()
        }
    }
}
