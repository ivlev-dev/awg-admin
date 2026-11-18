package space.ivlev.umbravpn.notification

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.sync.SyncEvent
import space.ivlev.umbravpn.domain.sync.SyncRemovalReason

class ManagedTunnelSyncNotifierTest {

    private val shown = mutableListOf<Pair<String, String>>()

    @Test
    fun updatedEventBuildsSummaryWithNames() {
        val notifier = notifier()

        notifier.publish(SyncEvent.Updated(count = 2, names = listOf("Pixel", "Pixel · awg1")))

        assertEquals(
            listOf("updated:2" to "Pixel, Pixel · awg1"),
            shown,
        )
    }

    @Test
    fun removedEventIncludesReason() {
        val notifier = notifier()

        notifier.publish(
            SyncEvent.Removed(
                count = 1,
                names = listOf("Pixel"),
                reason = SyncRemovalReason.Revoked,
            ),
        )

        assertEquals(listOf("removed:1" to "Pixel|revoked"), shown)
    }

    @Test
    fun removedPeerEventExplainsPeerRemoval() {
        val notifier = notifier()

        notifier.publish(
            SyncEvent.Removed(
                count = 1,
                names = listOf("Pixel · awg1"),
                reason = SyncRemovalReason.PeerRemoved,
            ),
        )

        assertEquals(listOf("removed:1" to "Pixel · awg1|peer_removed"), shown)
    }

    @Test
    fun namesAreLimitedToThreeAndReplacedWithCounter() {
        val notifier = notifier()

        notifier.publish(
            SyncEvent.Updated(count = 4, names = listOf("A", "B", "C", "D")),
        )

        assertEquals(listOf("updated:4" to "A, B, C +1"), shown)
    }

    @Test
    fun duplicateAndBlankNamesAreCollapsed() {
        val notifier = notifier()

        notifier.publish(
            SyncEvent.Updated(count = 2, names = listOf("A", "A", " ", "B")),
        )

        assertEquals(listOf("updated:2" to "A, B"), shown)
    }

    @Test
    fun emptyEventShowsNothing() {
        val notifier = notifier()

        notifier.publish(SyncEvent.Updated(count = 0, names = emptyList()))
        notifier.publish(
            SyncEvent.Removed(count = 0, names = emptyList(), reason = SyncRemovalReason.Deleted),
        )

        assertTrue(shown.isEmpty())
    }

    @Test
    fun deniedNotificationPermissionDoesNotShowOrThrow() {
        val notifier = notifier(allowed = false)

        notifier.publish(SyncEvent.Updated(count = 1, names = listOf("Pixel")))

        assertTrue(shown.isEmpty())
    }

    @Test
    fun notificationFailureDoesNotThrow() {
        val notifier = notifier(showAction = { _, _ -> throw SecurityException("denied") })

        notifier.publish(SyncEvent.Updated(count = 1, names = listOf("Pixel")))

        assertTrue(shown.isEmpty())
    }

    @Test
    fun summaryKeepsReasonForRemovedEvent() {
        val summary =
            SyncNotificationSummary.from(
                SyncEvent.Removed(2, listOf("Pixel"), SyncRemovalReason.Deleted),
            )

        assertEquals(2, summary?.count)
        assertEquals(listOf("Pixel"), summary?.names)
        assertEquals(true, summary?.removed)
        assertEquals(SyncRemovalReason.Deleted, summary?.reason)
    }

    private fun notifier(
        allowed: Boolean = true,
        showAction: (String, String) -> Unit = { title, text -> shown += title to text },
    ): ManagedTunnelSyncNotifier =
        ManagedTunnelSyncNotifier(
            events = emptyFlow(),
            scope = CoroutineScope(Dispatchers.Unconfined),
            isNotificationAllowed = { allowed },
            string = ::fakeString,
            show = showAction,
        )

    private fun fakeString(id: Int, args: Array<out Any>): String =
        when (id) {
            R.string.tunnels_sync_updated_title -> "updated:${args.firstOrNull() ?: ""}"
            R.string.tunnels_sync_removed_title -> "removed:${args.firstOrNull() ?: ""}"
            R.string.tunnels_sync_updated_text -> args.joinToString(", ")
            R.string.tunnels_sync_removed_text -> args.joinToString("|")
            R.string.tunnels_sync_more_names -> "+${args.firstOrNull() ?: ""}"
            R.string.tunnels_sync_reason_revoked -> "revoked"
            R.string.tunnels_sync_reason_deleted -> "deleted"
            R.string.tunnels_sync_reason_peer_removed -> "peer_removed"
            else -> id.toString()
        }
}
