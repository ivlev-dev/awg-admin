package space.ivlev.umbravpn.core.orchestration

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository

class ManagedTunnelAutoConnector(
    private val session: StateFlow<SessionState>,
    private val managedTunnelRepository: ManagedTunnelRepository,
    private val tunnelRepository: TunnelRepository,
    private val port: ManagedTunnelAutoConnectPort,
) {

    private val mutex = Mutex()
    private val state = AutoConnectState()
    private val _events = MutableSharedFlow<AutoConnectEvent>(extraBufferCapacity = 8)
    val events = _events.asSharedFlow()

    val pendingTunnelId: Int?
        get() = state.pendingTunnelId

    suspend fun ensureConnected(autoConnect: Boolean = true) = mutex.withLock {
        if (!autoConnect || state.isCompleted) return@withLock
        if (session.value !is SessionState.Active) return@withLock
        if (port.activeTunnelIds.isNotEmpty()) return@withLock

        val tunnel = loadPreferredTunnel() ?: return@withLock
        if (!port.hasVpnPermission()) {
            state.awaitPermission(tunnel.id)
            _events.tryEmit(AutoConnectEvent.NeedsPermission(tunnel.id))
            return@withLock
        }

        connect(tunnel)
    }

    suspend fun onPermissionGranted() = mutex.withLock {
        val tunnelId = state.pendingTunnelId ?: return@withLock
        state.clearPending()
        if (state.isCompleted) return@withLock
        if (session.value !is SessionState.Active) return@withLock
        if (port.activeTunnelIds.isNotEmpty()) return@withLock
        if (managedTunnelRepository.getByTunnelId(tunnelId) == null) return@withLock

        val tunnel = tunnelRepository.getById(tunnelId) ?: return@withLock
        connect(tunnel)
    }

    fun onManualDisconnect() {
        state.markManualDisconnect()
    }

    fun reset() {
        state.reset()
    }

    private suspend fun connect(tunnel: TunnelConfig) {
        if (port.startTunnel(tunnel)) {
            state.complete()
            _events.tryEmit(AutoConnectEvent.Connected(tunnel.id))
        } else {
            _events.tryEmit(AutoConnectEvent.Failed(tunnel.id))
        }
    }

    private suspend fun loadPreferredTunnel(): TunnelConfig? {
        val bindings = managedTunnelRepository.getAll()
        if (bindings.isEmpty()) return null
        val tunnels = bindings.mapNotNull { tunnelRepository.getById(it.tunnelId) }
        return selectAutoConnectTunnel(bindings, tunnels.associateBy { it.id })
    }
}

internal fun selectAutoConnectTunnel(
    bindings: List<ManagedTunnel>,
    tunnels: Map<Int, TunnelConfig>,
): TunnelConfig? =
    bindings
        .mapNotNull { tunnels[it.tunnelId] }
        .minWithOrNull(compareBy<TunnelConfig>({ it.position }, { it.id }))

internal class AutoConnectState {
    @Volatile private var completed = false
    @Volatile private var pending: Int? = null

    val isCompleted: Boolean
        get() = completed

    val pendingTunnelId: Int?
        get() = pending

    fun complete() {
        completed = true
        pending = null
    }

    fun awaitPermission(tunnelId: Int) {
        pending = tunnelId
    }

    fun clearPending() {
        pending = null
    }

    fun markManualDisconnect() {
        completed = true
        pending = null
    }

    fun reset() {
        completed = false
        pending = null
    }
}
