package space.ivlev.umbravpn.core.tunnel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import space.ivlev.umbravpn.domain.enums.TunnelActionSource
import space.ivlev.umbravpn.domain.events.TunnelActionEvent

// Tracks what started each active tunnel, since the backend has no notion of an action source.
class TunnelOriginHolder {

    private val _origins = MutableStateFlow<Map<Int, TunnelActionSource>>(emptyMap())
    val origins: StateFlow<Map<Int, TunnelActionSource>> = _origins

    fun bind(scope: CoroutineScope, actions: Flow<TunnelActionEvent>) {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            actions.collect { event ->
                when (event) {
                    is TunnelActionEvent.Started ->
                        _origins.update { it + (event.tunnelId to event.source) }
                    is TunnelActionEvent.Stopped -> _origins.update { it - event.tunnelId }
                }
            }
        }
    }
}
