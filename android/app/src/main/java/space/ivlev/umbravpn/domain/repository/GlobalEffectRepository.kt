package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect

class GlobalEffectRepository {

    private val _globalEffectFlow =
        MutableSharedFlow<GlobalSideEffect>(replay = 0, extraBufferCapacity = 0)
    val flow = _globalEffectFlow.asSharedFlow()

    val hasSubscribers: Boolean
        get() = _globalEffectFlow.subscriptionCount.value > 0

    suspend fun post(effect: GlobalSideEffect) {
        _globalEffectFlow.emit(effect)
    }
}
