package space.ivlev.umbravpn.domain

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.domain.model.account.filterDevices
import space.ivlev.umbravpn.domain.model.account.pageDevices

class DeviceQueryTest {
    @Test
    fun normalizesLimitAndOffset() {
        val query = DeviceQuery(limit = 0, offset = -5).normalized
        assertEquals(1, query.limit)
        assertEquals(0, query.offset)

        val oversized = DeviceQuery(limit = 10_000).normalized
        assertEquals(DeviceQuery.MAX_LIMIT, oversized.limit)
    }

    @Test
    fun trimsSearchText() {
        val query = DeviceQuery(query = "  pixel  ").normalized
        assertEquals("pixel", query.query)
    }

    @Test
    fun matchesNameIgnoringCase() {
        val query = DeviceQuery(query = "PIX")
        assertTrue(query.matches(device(id = "1", name = "Pixel 7")))
        assertFalse(query.matches(device(id = "2", name = "Laptop")))
    }

    @Test
    fun matchesAddress() {
        val query = DeviceQuery(query = "10.8.0.5")
        assertTrue(query.matches(device(id = "1", name = "Pixel", address = "10.8.0.5/32")))
        assertFalse(query.matches(device(id = "2", name = "Pixel", address = "10.8.0.6/32")))
    }

    @Test
    fun filtersByStatus() {
        val devices =
            listOf(
                device(id = "1", name = "Pixel", revoked = false),
                device(id = "2", name = "Old", revoked = true),
            )

        assertEquals(
            listOf("1"),
            devices.filterDevices(DeviceQuery(status = DeviceStatusFilter.Active)).map { it.id },
        )
        assertEquals(
            listOf("2"),
            devices.filterDevices(DeviceQuery(status = DeviceStatusFilter.Revoked)).map { it.id },
        )
        assertEquals(2, devices.filterDevices(DeviceQuery()).size)
    }

    @Test
    fun pagesFilteredItems() {
        val devices = (1..25).map { device(id = "$it", name = "Device $it") }

        val first = devices.pageDevices(DeviceQuery(limit = 20, offset = 0))
        assertEquals(20, first.items.size)
        assertEquals(25, first.total)
        assertEquals(0, first.offset)
        assertTrue(first.hasMore)

        val second = devices.pageDevices(DeviceQuery(limit = 20, offset = 20))
        assertEquals(listOf("21", "22", "23", "24", "25"), second.items.map { it.id })
        assertEquals(25, second.total)
        assertEquals(20, second.offset)
        assertFalse(second.hasMore)
    }

    @Test
    fun pageBeyondTotalIsEmptyAndHasNoMore() {
        val devices = (1..3).map { device(id = "$it", name = "Device $it") }

        val page = devices.pageDevices(DeviceQuery(limit = 20, offset = 10))

        assertTrue(page.items.isEmpty())
        assertEquals(3, page.total)
        assertFalse(page.hasMore)
    }

    @Test
    fun statusFilterParsesApiValues() {
        assertEquals(DeviceStatusFilter.All, DeviceStatusFilter.fromApi(null))
        assertEquals(DeviceStatusFilter.All, DeviceStatusFilter.fromApi(""))
        assertEquals(DeviceStatusFilter.Active, DeviceStatusFilter.fromApi(" ACTIVE "))
        assertEquals(DeviceStatusFilter.Revoked, DeviceStatusFilter.fromApi("revoked"))
        assertEquals(DeviceStatusFilter.All, DeviceStatusFilter.fromApi("unknown"))
    }

    private fun device(
        id: String,
        name: String,
        revoked: Boolean = false,
        address: String = "10.8.0.2/32",
    ): AccountDevice =
        AccountDevice(
            id = id,
            userId = "user-1",
            groupId = null,
            interfaceId = "iface-1",
            interfaceName = "awg0",
            nodeId = "node-1",
            nodeName = "Frankfurt",
            name = name,
            downKbps = 0,
            upKbps = 0,
            revoked = revoked,
            external = false,
            addresses = listOf(address),
            peers = emptyList(),
            createdAt = Instant.parse("2026-01-03T09:00:00Z"),
        )
}
