package space.ivlev.umbravpn.ui.navigation.components

import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.Route.AdminAudit
import space.ivlev.umbravpn.ui.navigation.Route.AdminGroupForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminGroups
import space.ivlev.umbravpn.ui.navigation.Route.AdminHub
import space.ivlev.umbravpn.ui.navigation.Route.AdminInterfaceForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminInterfaces
import space.ivlev.umbravpn.ui.navigation.Route.AdminNodeForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminNodes
import space.ivlev.umbravpn.ui.navigation.Route.AdminPlaceholder
import space.ivlev.umbravpn.ui.navigation.Route.AdminPoolForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminPools
import space.ivlev.umbravpn.ui.navigation.Route.AdminSettings
import space.ivlev.umbravpn.ui.navigation.Route.AdminStats
import space.ivlev.umbravpn.ui.navigation.Route.AdminTariffForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminTariffs
import space.ivlev.umbravpn.ui.navigation.Route.AdminUserForm
import space.ivlev.umbravpn.ui.navigation.Route.AdminUsers
import space.ivlev.umbravpn.ui.state.NavbarState

internal fun adminNavbarState(context: NavbarContext, route: Route?): NavbarState? =
    when (route) {
        AdminHub ->
            NavbarState(topTitle = context.title(R.string.admin_hub_title), showBottomItems = true)
        AdminUsers -> context.backTitleState(R.string.admin_users_title)
        AdminTariffs -> context.backTitleState(R.string.admin_tariffs_title)
        is AdminUserForm ->
            context.backTitleState(
                if (route.id == null) R.string.admin_user_create_title
                else R.string.admin_user_edit_title,
            )
        is AdminTariffForm ->
            context.backTitleState(
                if (route.id == null) R.string.admin_tariff_create_title
                else R.string.admin_tariff_edit_title,
            )
        AdminNodes -> context.backTitleState(R.string.admin_nodes_title)
        AdminNodeForm -> context.backTitleState(R.string.admin_node_create_title)
        AdminInterfaces -> context.backTitleState(R.string.admin_interfaces_title)
        is AdminInterfaceForm ->
            context.backTitleState(
                if (route.id == null) R.string.admin_interface_create_title
                else R.string.admin_interface_edit_title,
            )
        AdminGroups -> context.backTitleState(R.string.admin_groups_title)
        is AdminGroupForm ->
            context.backTitleState(
                if (route.id == null) R.string.admin_group_create_title
                else R.string.admin_group_edit_title,
            )
        is AdminPools -> context.backTitleState(R.string.admin_pools_title)
        is AdminPoolForm ->
            context.backTitleState(
                if (route.id == null) R.string.admin_pool_create_title
                else R.string.admin_pool_edit_title,
            )
        AdminAudit -> context.backTitleState(R.string.admin_hub_audit)
        AdminStats -> context.backTitleState(R.string.admin_hub_stats)
        AdminSettings -> context.backTitleState(R.string.admin_hub_settings)
        is AdminPlaceholder -> context.backTitleState(route.section.titleRes)
        else -> null
    }
