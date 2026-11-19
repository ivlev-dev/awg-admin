package space.ivlev.umbravpn.account

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import space.ivlev.umbravpn.data.account.AccountSnapshotCache
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AccountTariff
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

class AccountSnapshotCacheTest {

    @Test
    fun roundTripsSnapshotIncludingInstants() = runTest {
        val repository = FakeAccountSettingsRepository()
        val cache = AccountSnapshotCache(repository)
        val snapshot = snapshot()

        cache.save(snapshot)
        val restored = cache.load()

        assertEquals(snapshot.user.id, restored?.user?.id)
        assertEquals(snapshot.user.createdAt, restored?.user?.createdAt)
        assertEquals(1, restored?.devices?.size)
        assertEquals("dev-1", restored?.devices?.first()?.id)
        assertEquals("peer-1", restored?.devices?.first()?.peers?.first()?.peerId)
        assertEquals(snapshot.quota.resetAt, restored?.quota?.resetAt)
        assertEquals("Tariff", restored?.tariff?.name)
    }

    @Test
    fun clearsStoredSnapshot() = runTest {
        val repository = FakeAccountSettingsRepository()
        val cache = AccountSnapshotCache(repository)

        cache.save(snapshot())
        cache.clear()

        assertNull(cache.load())
    }

    @Test
    fun ignoresCorruptedCache() = runTest {
        val repository = FakeAccountSettingsRepository()
        repository.cachedSnapshotState = "{not json"
        val cache = AccountSnapshotCache(repository)

        assertNull(cache.load())
    }

    private fun snapshot(): AccountSnapshot {
        val now = Instant.parse("2026-02-01T12:00:00Z")
        return AccountSnapshot(
            user =
                AuthUser(
                    id = "user-1",
                    fullName = "User Example",
                    email = "user@example.com",
                    status = UserStatus.Active,
                    totpEnabled = true,
                    role = UserRole.User,
                    createdAt = now,
                    updatedAt = now,
                ),
            tariff =
                AccountTariff(
                    id = "tariff-1",
                    name = "Tariff",
                    description = "",
                    maxDevices = 5,
                    deviceDownKbps = 100_000,
                    deviceUpKbps = 100_000,
                    trafficQuotaBytes = 1024L,
                ),
            quota =
                AccountQuota(
                    usedBytes = 512L,
                    quotaBytes = 1024L,
                    exceeded = false,
                    remainingBytes = 512L,
                    percent = 50.0,
                    periodStart = now,
                    periodEnd = now,
                    resetAt = now,
                ),
            devices =
                listOf(
                    AccountDevice(
                        id = "dev-1",
                        userId = "user-1",
                        groupId = null,
                        interfaceId = "wg0",
                        interfaceName = "wg0",
                        nodeId = "node-1",
                        nodeName = "node",
                        name = "Laptop",
                        downKbps = 100_000,
                        upKbps = 100_000,
                        revoked = false,
                        external = false,
                        addresses = listOf("10.0.0.2"),
                        peers =
                            listOf(
                                DevicePeer(
                                    interfaceId = "wg0",
                                    interfaceName = "wg0",
                                    peerId = "peer-1",
                                ),
                            ),
                        createdAt = now,
                    ),
                ),
        )
    }
}
