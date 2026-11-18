package space.ivlev.umbravpn.notification

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.sync.SyncEvent
import space.ivlev.umbravpn.domain.sync.SyncRemovalReason
import timber.log.Timber

class ManagedTunnelSyncNotifier(
    private val events: Flow<SyncEvent>,
    private val scope: CoroutineScope,
    private val isNotificationAllowed: () -> Boolean,
    private val string: (id: Int, args: Array<out Any>) -> String,
    private val show: (title: String, text: String) -> Unit,
) {
    fun start() {
        scope.launch {
            events.collect { event ->
                try {
                    publish(event)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "Managed tunnel sync notification failed")
                }
            }
        }
    }

    fun publish(event: SyncEvent) {
        val summary = SyncNotificationSummary.from(event) ?: return
        if (!isNotificationAllowed()) return
        try {
            show(title(summary), text(summary))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "Managed tunnel sync notification failed")
        }
    }

    private fun title(summary: SyncNotificationSummary): String =
        string(
            if (summary.removed) R.string.tunnels_sync_removed_title
            else R.string.tunnels_sync_updated_title,
            arrayOf<Any>(summary.count),
        )

    private fun text(summary: SyncNotificationSummary): String {
        val names = summary.names.joinToString(", ")
        val more =
            if (summary.hiddenNames > 0) {
                string(R.string.tunnels_sync_more_names, arrayOf<Any>(summary.hiddenNames))
            } else {
                null
            }
        val namesText = listOfNotNull(names.takeIf { it.isNotEmpty() }, more).joinToString(" ")
        return if (summary.removed) {
            string(
                R.string.tunnels_sync_removed_text,
                arrayOf<Any>(namesText, reasonText(summary.reason)),
            )
        } else {
            string(R.string.tunnels_sync_updated_text, arrayOf<Any>(namesText))
        }
    }

    private fun reasonText(reason: SyncRemovalReason?): String =
        string(
            when (reason) {
                SyncRemovalReason.Revoked -> R.string.tunnels_sync_reason_revoked
                SyncRemovalReason.Deleted -> R.string.tunnels_sync_reason_deleted
                SyncRemovalReason.PeerRemoved,
                null -> R.string.tunnels_sync_reason_peer_removed
            },
            emptyArray(),
        )
}

internal data class SyncNotificationSummary(
    val count: Int,
    val names: List<String>,
    val hiddenNames: Int,
    val removed: Boolean,
    val reason: SyncRemovalReason?,
) {
    companion object {
        const val MAX_NAMES = 3

        fun from(event: SyncEvent): SyncNotificationSummary? =
            when (event) {
                is SyncEvent.Updated ->
                    create(count = event.count, names = event.names, removed = false, reason = null)
                is SyncEvent.Removed ->
                    create(
                        count = event.count,
                        names = event.names,
                        removed = true,
                        reason = event.reason,
                    )
            }

        private fun create(
            count: Int,
            names: List<String>,
            removed: Boolean,
            reason: SyncRemovalReason?,
        ): SyncNotificationSummary? {
            if (count <= 0) return null
            val cleaned = names.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
            return SyncNotificationSummary(
                count = count,
                names = cleaned.take(MAX_NAMES),
                hiddenNames = (cleaned.size - MAX_NAMES).coerceAtLeast(0),
                removed = removed,
                reason = if (removed) reason ?: SyncRemovalReason.PeerRemoved else null,
            )
        }
    }
}
