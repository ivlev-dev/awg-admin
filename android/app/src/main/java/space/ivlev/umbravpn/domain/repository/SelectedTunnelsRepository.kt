package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.TunnelGroup

data class TunnelsSelection(
    val tunnels: List<TunnelConfig> = emptyList(),
    val groups: List<TunnelGroup> = emptyList(),
) {
    val count: Int
        get() = tunnels.size + groups.size

    val isEmpty: Boolean
        get() = count == 0
}

class SelectedTunnelsRepository {
    private val _selection = MutableStateFlow(TunnelsSelection())
    val flow = _selection.asStateFlow()

    fun clear() {
        _selection.update { TunnelsSelection() }
    }

    fun set(selection: TunnelsSelection) {
        _selection.update { selection }
    }
}
