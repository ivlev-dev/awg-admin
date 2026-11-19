package space.ivlev.umbravpn.viewmodel.shared

import com.dokar.sonner.ToastType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncResult
import space.ivlev.umbravpn.util.StringValue

internal class TunnelSyncSupport(
    private val managedTunnelSyncService: ManagedTunnelSyncService,
    private val globalEffectRepository: GlobalEffectRepository,
) {
    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    suspend fun refresh() {
        if (_isSyncing.value) return
        _isSyncing.value = true
        try {
            when (val result = managedTunnelSyncService.sync()) {
                SyncResult.NotConfigured,
                is SyncResult.Success -> Unit
                SyncResult.Offline -> postSyncError(R.string.account_error_network)
                SyncResult.SessionExpired -> postSyncError(R.string.account_error_session_expired)
                is SyncResult.Failed -> postSyncError(R.string.unknown_error)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            postSyncError(R.string.unknown_error)
        } finally {
            _isSyncing.value = false
        }
    }

    private suspend fun postSyncError(messageRes: Int) {
        globalEffectRepository.post(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(messageRes),
                ToastType.Error,
            ),
        )
    }
}
