package space.ivlev.umbravpn.data.repository

import space.ivlev.umbravpn.data.admin.AdminApi
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPage
import space.ivlev.umbravpn.domain.model.admin.AdminAuditQuery
import space.ivlev.umbravpn.domain.model.admin.AdminDashboard
import space.ivlev.umbravpn.domain.model.admin.AdminGroup
import space.ivlev.umbravpn.domain.model.admin.AdminGroupDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterface
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceDraft
import space.ivlev.umbravpn.domain.model.admin.AdminInterfaceUpdate
import space.ivlev.umbravpn.domain.model.admin.AdminNode
import space.ivlev.umbravpn.domain.model.admin.AdminNodeDraft
import space.ivlev.umbravpn.domain.model.admin.AdminNodeSecret
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminPool
import space.ivlev.umbravpn.domain.model.admin.AdminPoolDraft
import space.ivlev.umbravpn.domain.model.admin.AdminPoolUpdate
import space.ivlev.umbravpn.domain.model.admin.AdminQuotaUser
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminStatsQuery
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.repository.AdminRepository

class KtorAdminRepository(private val api: AdminApi) : AdminRepository {
    override suspend fun pageUsers(query: AdminUserQuery): AccountResult<Page<AdminUser>> =
        api.pageUsers(query)

    override suspend fun pendingUsers(): AccountResult<List<AdminUser>> = api.pendingUsers()

    override suspend fun user(id: String): AccountResult<AdminUser> = api.user(id)

    override suspend fun createUser(draft: AdminUserDraft): AccountResult<AdminUser> =
        api.createUser(draft)

    override suspend fun updateUser(
        id: String,
        draft: AdminUserDraft,
    ): AccountResult<AdminUser> = api.updateUser(id, draft)

    override suspend fun deleteUser(id: String): AccountResult<Unit> = api.deleteUser(id)

    override suspend fun resetPassword(id: String, newPassword: String): AccountResult<Unit> =
        api.resetPassword(id, newPassword)

    override suspend fun approveUser(
        id: String,
        tariffId: String,
        nodeId: String?,
        groupId: String?,
    ): AccountResult<AdminUser> = api.approveUser(id, tariffId, nodeId, groupId)

    override suspend fun rejectUser(id: String): AccountResult<AdminUser> = api.rejectUser(id)

    override suspend fun listTariffs(): AccountResult<List<AdminTariff>> = api.listTariffs()

    override suspend fun createTariff(draft: AdminTariffDraft): AccountResult<AdminTariff> =
        api.createTariff(draft)

    override suspend fun updateTariff(
        id: String,
        draft: AdminTariffDraft,
    ): AccountResult<AdminTariff> = api.updateTariff(id, draft)

    override suspend fun deleteTariff(id: String): AccountResult<Unit> = api.deleteTariff(id)

    override suspend fun dashboard(): AccountResult<AdminDashboard> = api.dashboard()

    override suspend fun overview(): AccountResult<AdminOverview> = api.overview()

    override suspend fun audit(query: AdminAuditQuery): AccountResult<AdminAuditPage> =
        api.audit(query)

    override suspend fun traffic(query: AdminStatsQuery): AccountResult<List<AdminTrafficPoint>> =
        if (query.period == AdminStatsPeriod.Day24) {
            api.trafficSeries(scope = GLOBAL_SCOPE, from = query.from, to = query.to)
        } else {
            api.trafficAggregate(
                scope = GLOBAL_SCOPE,
                bucket = DAY_BUCKET,
                from = query.from,
                to = query.to,
            )
        }

    override suspend fun quotaUsers(): AccountResult<List<AdminQuotaUser>> = api.quotaUsers()

    override suspend fun settings(): AccountResult<AdminPanelSettings> = api.settings()

    override suspend fun updateSettings(
        settings: AdminPanelSettings,
    ): AccountResult<AdminPanelSettings> = api.updateSettings(settings)

    override suspend fun listNodes(): AccountResult<List<AdminOption>> = api.listNodes()

    override suspend fun listGroups(): AccountResult<List<AdminOption>> = api.listGroups()

    override suspend fun listInterfaces(): AccountResult<List<AdminOption>> = api.listInterfaces()

    override suspend fun nodes(): AccountResult<List<AdminNode>> = api.nodes()

    override suspend fun createNode(draft: AdminNodeDraft): AccountResult<AdminNodeSecret> =
        api.createNode(draft)

    override suspend fun deleteNode(id: String): AccountResult<Unit> = api.deleteNode(id)

    override suspend fun rotateNodeToken(id: String): AccountResult<AdminNodeSecret> =
        api.rotateNodeToken(id)

    override suspend fun interfaces(): AccountResult<List<AdminInterface>> = api.interfaces()

    override suspend fun createInterface(
        draft: AdminInterfaceDraft,
    ): AccountResult<AdminInterface> = api.createInterface(draft)

    override suspend fun updateInterface(
        id: String,
        update: AdminInterfaceUpdate,
    ): AccountResult<AdminInterface> = api.updateInterface(id, update)

    override suspend fun deleteInterface(id: String): AccountResult<Unit> = api.deleteInterface(id)

    override suspend fun rotateInterface(id: String): AccountResult<AdminInterface> =
        api.rotateInterface(id)

    override suspend fun groups(): AccountResult<List<AdminGroup>> = api.groups()

    override suspend fun createGroup(draft: AdminGroupDraft): AccountResult<AdminGroup> =
        api.createGroup(draft)

    override suspend fun updateGroup(
        id: String,
        draft: AdminGroupDraft,
    ): AccountResult<AdminGroup> = api.updateGroup(id, draft)

    override suspend fun deleteGroup(id: String): AccountResult<Unit> = api.deleteGroup(id)

    override suspend fun pools(groupId: String): AccountResult<List<AdminPool>> = api.pools(groupId)

    override suspend fun createPool(
        groupId: String,
        draft: AdminPoolDraft,
    ): AccountResult<AdminPool> = api.createPool(groupId, draft)

    override suspend fun updatePool(id: String, update: AdminPoolUpdate): AccountResult<AdminPool> =
        api.updatePool(id, update)

    override suspend fun deletePool(id: String): AccountResult<Unit> = api.deletePool(id)
}

private const val GLOBAL_SCOPE = "global"
private const val DAY_BUCKET = "day"
