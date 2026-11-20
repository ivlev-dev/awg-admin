package space.ivlev.umbravpn.domain.repository

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
import space.ivlev.umbravpn.domain.model.admin.AdminStatsQuery
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery

interface AdminRepository {
    suspend fun pageUsers(query: AdminUserQuery): AccountResult<Page<AdminUser>>

    suspend fun pendingUsers(): AccountResult<List<AdminUser>>

    suspend fun user(id: String): AccountResult<AdminUser>

    suspend fun createUser(draft: AdminUserDraft): AccountResult<AdminUser>

    suspend fun updateUser(id: String, draft: AdminUserDraft): AccountResult<AdminUser>

    suspend fun deleteUser(id: String): AccountResult<Unit>

    suspend fun resetPassword(id: String, newPassword: String): AccountResult<Unit>

    suspend fun approveUser(
        id: String,
        tariffId: String,
        nodeId: String? = null,
        groupId: String? = null,
    ): AccountResult<AdminUser>

    suspend fun rejectUser(id: String): AccountResult<AdminUser>

    suspend fun listTariffs(): AccountResult<List<AdminTariff>>

    suspend fun createTariff(draft: AdminTariffDraft): AccountResult<AdminTariff>

    suspend fun updateTariff(id: String, draft: AdminTariffDraft): AccountResult<AdminTariff>

    suspend fun deleteTariff(id: String): AccountResult<Unit>

    suspend fun dashboard(): AccountResult<AdminDashboard>

    suspend fun overview(): AccountResult<AdminOverview>

    suspend fun audit(query: AdminAuditQuery): AccountResult<AdminAuditPage>

    suspend fun traffic(query: AdminStatsQuery): AccountResult<List<AdminTrafficPoint>>

    suspend fun quotaUsers(): AccountResult<List<AdminQuotaUser>>

    suspend fun settings(): AccountResult<AdminPanelSettings>

    suspend fun updateSettings(settings: AdminPanelSettings): AccountResult<AdminPanelSettings>

    suspend fun listNodes(): AccountResult<List<AdminOption>>

    suspend fun listGroups(): AccountResult<List<AdminOption>>

    suspend fun listInterfaces(): AccountResult<List<AdminOption>>

    suspend fun nodes(): AccountResult<List<AdminNode>>

    suspend fun createNode(draft: AdminNodeDraft): AccountResult<AdminNodeSecret>

    suspend fun deleteNode(id: String): AccountResult<Unit>

    suspend fun rotateNodeToken(id: String): AccountResult<AdminNodeSecret>

    suspend fun interfaces(): AccountResult<List<AdminInterface>>

    suspend fun createInterface(draft: AdminInterfaceDraft): AccountResult<AdminInterface>

    suspend fun updateInterface(
        id: String,
        update: AdminInterfaceUpdate,
    ): AccountResult<AdminInterface>

    suspend fun deleteInterface(id: String): AccountResult<Unit>

    suspend fun rotateInterface(id: String): AccountResult<AdminInterface>

    suspend fun groups(): AccountResult<List<AdminGroup>>

    suspend fun createGroup(draft: AdminGroupDraft): AccountResult<AdminGroup>

    suspend fun updateGroup(id: String, draft: AdminGroupDraft): AccountResult<AdminGroup>

    suspend fun deleteGroup(id: String): AccountResult<Unit>

    suspend fun pools(groupId: String): AccountResult<List<AdminPool>>

    suspend fun createPool(groupId: String, draft: AdminPoolDraft): AccountResult<AdminPool>

    suspend fun updatePool(id: String, update: AdminPoolUpdate): AccountResult<AdminPool>

    suspend fun deletePool(id: String): AccountResult<Unit>
}
