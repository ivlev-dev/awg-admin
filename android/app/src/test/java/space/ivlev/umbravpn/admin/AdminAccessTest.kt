package space.ivlev.umbravpn.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.ivlev.umbravpn.domain.admin.isAdmin
import space.ivlev.umbravpn.domain.admin.isAdminSession
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.ui.navigation.AdminSection
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Tab
import space.ivlev.umbravpn.ui.navigation.isAdminRoute
import space.ivlev.umbravpn.ui.navigation.visibleTabs

class AdminAccessTest {

    @Test
    fun adminTabIsVisibleOnlyForAdmins() {
        assertFalse(Tab.ADMIN in visibleTabs(isAdmin = false))
        assertTrue(Tab.ADMIN in visibleTabs(isAdmin = true))
        assertEquals(Tab.entries.size - 1, visibleTabs(isAdmin = false).size)
        assertEquals(Tab.entries.size, visibleTabs(isAdmin = true).size)
        assertEquals(4, Tab.ADMIN.index)
    }

    @Test
    fun everyAdminRouteIsGuarded() {
        val adminRoutes =
            listOf(
                Route.AdminHub,
                Route.AdminUsers,
                Route.AdminTariffs,
                Route.AdminUserForm(),
                Route.AdminUserForm("user-1"),
                Route.AdminTariffForm(),
                Route.AdminTariffForm("tariff-1"),
                Route.AdminNodes,
                Route.AdminNodeForm,
                Route.AdminInterfaces,
                Route.AdminInterfaceForm(),
                Route.AdminInterfaceForm("iface-1"),
                Route.AdminGroups,
                Route.AdminGroupForm(),
                Route.AdminGroupForm("group-1"),
                Route.AdminPools("group-1"),
                Route.AdminPoolForm("group-1"),
                Route.AdminPoolForm("group-1", "pool-1"),
                Route.AdminAudit,
                Route.AdminStats,
                Route.AdminSettings,
                Route.AdminPlaceholder(AdminSection.Nodes),
                Route.AdminPlaceholder(AdminSection.Interfaces),
                Route.AdminPlaceholder(AdminSection.Groups),
                Route.AdminPlaceholder(AdminSection.Audit),
                Route.AdminPlaceholder(AdminSection.Stats),
                Route.AdminPlaceholder(AdminSection.Settings),
            )

        adminRoutes.forEach { route ->
            assertTrue("expected admin route: $route", route.isAdminRoute())
            assertEquals(Tab.ADMIN, Tab.fromRoute(route))
        }
        assertFalse(Route.Tunnels.isAdminRoute())
        assertFalse(Route.Account.isAdminRoute())
        assertFalse(Route.Settings.isAdminRoute())
        assertFalse(Route.Support.isAdminRoute())
    }

    @Test
    fun sessionGuardRequiresActiveAdmin() {
        assertTrue(adminSession(UserRole.Admin).isAdminSession())
        assertFalse(adminSession(UserRole.User).isAdminSession())
        assertFalse(SessionState.LoggedOut.isAdminSession())
        assertFalse(SessionState.Unknown.isAdminSession())
        assertTrue(adminSession(UserRole.Admin).let { (it as SessionState.Active).user.isAdmin() })
    }
}
