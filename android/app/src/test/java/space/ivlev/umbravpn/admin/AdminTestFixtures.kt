package space.ivlev.umbravpn.admin

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.account.FakeAccountSettingsRepository
import space.ivlev.umbravpn.account.InMemoryTokenStore
import space.ivlev.umbravpn.account.storedSession
import space.ivlev.umbravpn.account.testJson
import space.ivlev.umbravpn.data.account.SessionManager
import space.ivlev.umbravpn.data.admin.AdminApi
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.admin.AdminAuditEntry
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
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.domain.model.admin.AdminPoolUpdate
import space.ivlev.umbravpn.domain.model.admin.AdminQuotaUser
import space.ivlev.umbravpn.domain.model.admin.AdminStatsQuery
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.repository.AdminRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository

internal fun adminUser(
    id: String = "user-1",
    email: String = "alice@example.com",
    fullName: String? = "Alice Ivanova",
    status: UserStatus = UserStatus.Active,
    role: UserRole = UserRole.User,
    tariffId: String? = "tariff-1",
    nodeId: String? = null,
    groupId: String? = null,
    disabled: Boolean = false,
): AdminUser =
    AdminUser(
        id = id,
        email = email,
        fullName = fullName,
        status = status,
        role = role,
        tariffId = tariffId,
        nodeId = nodeId,
        groupId = groupId,
        disabled = disabled,
    )

internal fun adminTariff(
    id: String = "tariff-1",
    name: String = "Standard",
    description: String = "Five devices",
    maxDevices: Int = 5,
    deviceDownKbps: Int = 100_000,
    deviceUpKbps: Int = 50_000,
    trafficQuotaBytes: Long? = null,
    interfaceId: String? = null,
    interfaceName: String? = null,
): AdminTariff =
    AdminTariff(
        id = id,
        name = name,
        description = description,
        maxDevices = maxDevices,
        deviceDownKbps = deviceDownKbps,
        deviceUpKbps = deviceUpKbps,
        trafficQuotaBytes = trafficQuotaBytes,
        interfaceId = interfaceId,
        interfaceName = interfaceName,
    )

internal fun adminNode(
    id: String = "node-1",
    name: String = "Frankfurt",
    online: Boolean = true,
    interfaces: Int = 2,
): AdminNode =
    AdminNode(
        id = id,
        name = name,
        online = online,
        interfaces = interfaces,
        workerVersion = "1.4.0",
    )

internal fun adminInterface(
    id: String = "iface-1",
    groupId: String = "group-1",
    groupName: String = "Default",
    nodeId: String = "node-1",
    nodeName: String = "Frankfurt",
    name: String = "awg0",
    label: String = "Main",
    enabled: Boolean = true,
): AdminInterface =
    AdminInterface(
        id = id,
        groupId = groupId,
        groupName = groupName,
        nodeId = nodeId,
        nodeName = nodeName,
        name = name,
        label = label,
        endpointHost = "vpn.example.com",
        endpointPort = 51820,
        listenPort = 51820,
        mtu = 1420,
        publicKey = "public-key",
        enabled = enabled,
        peers = 3,
    )

internal fun adminGroup(
    id: String = "group-1",
    name: String = "Default",
    interfaces: Int = 1,
    devices: Int = 2,
): AdminGroup =
    AdminGroup(
        id = id,
        name = name,
        description = "Main group",
        baseCidr = "10.8.0.0/24",
        interfaces = interfaces,
        devices = devices,
    )

internal fun adminPool(
    id: String = "pool-1",
    groupId: String = "group-1",
    name: String = "Auto pool",
    enabled: Boolean = true,
): AdminPool =
    AdminPool(
        id = id,
        groupId = groupId,
        name = name,
        cidr = "10.8.0.0/25",
        mode = AdminPoolMode.Auto,
        gateway = "10.8.0.1",
        enabled = enabled,
    )

internal fun adminAuditEntry(
    id: String = "audit-1",
    at: Instant? = Instant.parse("2026-11-20T10:00:00Z"),
    actorEmail: String = "admin@example.com",
    action: String = "PATCH",
    entity: String = "users",
    entityId: String? = "user-1",
    status: Int = 200,
    details: String? = null,
): AdminAuditEntry =
    AdminAuditEntry(
        id = id,
        at = at,
        actorEmail = actorEmail,
        actorLogin = actorEmail,
        action = action,
        entity = entity,
        entityId = entityId,
        status = status,
        ip = "203.0.113.10",
        details = details,
    )

internal fun adminPanelSettings(
    profile: String = "http3",
    shareDefaultTtlSecs: Long = 86_400,
    statsRetentionDays: Int = 90,
): AdminPanelSettings =
    AdminPanelSettings(
        obfuscation =
            space.ivlev.umbravpn.domain.model.admin.AdminObfuscation(
                profile =
                    space.ivlev.umbravpn.domain.model.admin.AdminObfuscationProfile.fromApi(
                        profile,
                    ),
            ),
        shareDefaultTtlSecs = shareDefaultTtlSecs,
        statsRetentionDays = statsRetentionDays,
    )

internal fun adminQuotaUser(
    userId: String = "user-1",
    email: String = "alice@example.com",
    usedBytes: Long = 500,
    quotaBytes: Long? = 1_000,
    exceeded: Boolean = false,
    percent: Double? = 50.0,
): AdminQuotaUser =
    AdminQuotaUser(
        userId = userId,
        email = email,
        usedBytes = usedBytes,
        quotaBytes = quotaBytes,
        exceeded = exceeded,
        percent = percent,
    )

internal fun adminSession(role: UserRole = UserRole.Admin): SessionState =
    SessionState.Active(
        AuthUser(
            id = "admin-1",
            email = "admin@example.com",
            fullName = "Admin",
            status = UserStatus.Active,
            totpEnabled = false,
            role = role,
        ),
    )

internal class FakeAdminAuthRepository(
    initial: SessionState = adminSession(),
) : AuthRepository {
    private val state = MutableStateFlow(initial)

    override val session: StateFlow<SessionState> = state

    fun setSession(value: SessionState) {
        state.value = value
    }

    override suspend fun login(
        email: String,
        password: String,
        totpCode: String?,
    ): AccountResult<AuthUser> = AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun register(
        email: String,
        password: String,
        fullName: String?,
    ): AccountResult<Unit> = AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun verifyEmail(token: String): AccountResult<Unit> =
        AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun resendVerification(email: String): AccountResult<Unit> =
        AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun forgotPassword(email: String): AccountResult<Unit> =
        AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun resetPassword(token: String, password: String): AccountResult<Unit> =
        AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun me(): AccountResult<AuthUser> =
        AccountResult.Failure(AccountError.Unauthorized)

    override suspend fun logout(): AccountResult<Unit> = AccountResult.Success(Unit)
}

internal class FakeAdminRepository : AdminRepository {
    var pageHandler: ((AdminUserQuery) -> AccountResult<Page<AdminUser>>)? = null
    var pageResult: AccountResult<Page<AdminUser>> =
        AccountResult.Success(Page(emptyList(), 0, 20, 0))
    val queries = mutableListOf<AdminUserQuery>()

    var pendingResult: AccountResult<List<AdminUser>> = AccountResult.Success(emptyList())

    var userResult: AccountResult<AdminUser> = AccountResult.Success(adminUser())
    var createUserResult: AccountResult<AdminUser> = AccountResult.Success(adminUser())

    var updateUserResult: AccountResult<AdminUser> = AccountResult.Success(adminUser())
    var deleteUserResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var resetPasswordResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var approveResult: AccountResult<AdminUser> =
        AccountResult.Success(adminUser(status = UserStatus.Active))
    var rejectResult: AccountResult<AdminUser> =
        AccountResult.Success(adminUser(status = UserStatus.Rejected))

    var listTariffsResult: AccountResult<List<AdminTariff>> =
        AccountResult.Success(listOf(adminTariff()))
    var createTariffResult: AccountResult<AdminTariff> = AccountResult.Success(adminTariff())
    var updateTariffResult: AccountResult<AdminTariff> = AccountResult.Success(adminTariff())
    var deleteTariffResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var dashboardResult: AccountResult<AdminDashboard> =
        AccountResult.Success(
            AdminDashboard(
                overview =
                    AdminOverview(
                        users = 12,
                        devices = 34,
                        nodesOnline = 2,
                        nodesTotal = 3,
                        interfaces = 5,
                        groups = 2,
                    ),
                pendingUsers = 4,
            ),
        )
    var overviewResult: AccountResult<AdminOverview> =
        AccountResult.Success(
            AdminOverview(
                users = 12,
                devices = 34,
                nodesOnline = 2,
                nodesTotal = 3,
                interfaces = 5,
                groups = 2,
            ),
        )
    var auditHandler: ((AdminAuditQuery) -> AccountResult<AdminAuditPage>)? = null
    var auditResult: AccountResult<AdminAuditPage> =
        AccountResult.Success(AdminAuditPage(emptyList(), null))
    val auditQueries = mutableListOf<AdminAuditQuery>()
    var trafficHandler: ((AdminStatsQuery) -> AccountResult<List<AdminTrafficPoint>>)? = null
    var trafficResult: AccountResult<List<AdminTrafficPoint>> = AccountResult.Success(emptyList())
    val trafficQueries = mutableListOf<AdminStatsQuery>()
    var quotaUsersResult: AccountResult<List<AdminQuotaUser>> = AccountResult.Success(emptyList())
    var settingsResult: AccountResult<AdminPanelSettings> =
        AccountResult.Success(adminPanelSettings())
    var updateSettingsResult: AccountResult<AdminPanelSettings>? = null
    val settingsUpdates = mutableListOf<AdminPanelSettings>()
    var settingsCalls = 0
    var overviewCalls = 0

    var nodesResult: AccountResult<List<AdminOption>> =
        AccountResult.Success(listOf(AdminOption("node-1", "Frankfurt")))
    var groupsResult: AccountResult<List<AdminOption>> =
        AccountResult.Success(listOf(AdminOption("group-1", "Default")))
    var interfacesResult: AccountResult<List<AdminOption>> =
        AccountResult.Success(listOf(AdminOption("iface-1", "awg0")))

    var nodeListResult: AccountResult<List<AdminNode>> = AccountResult.Success(listOf(adminNode()))
    var createNodeResult: AccountResult<AdminNodeSecret> =
        AccountResult.Success(AdminNodeSecret("node-1", "Frankfurt", "token-1"))
    var deleteNodeResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var rotateNodeResult: AccountResult<AdminNodeSecret> =
        AccountResult.Success(AdminNodeSecret("node-1", "Frankfurt", "rotated-token"))

    var interfaceListResult: AccountResult<List<AdminInterface>> =
        AccountResult.Success(listOf(adminInterface()))
    var createInterfaceResult: AccountResult<AdminInterface> =
        AccountResult.Success(adminInterface())
    var updateInterfaceResult: AccountResult<AdminInterface> =
        AccountResult.Success(adminInterface())
    var deleteInterfaceResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var rotateInterfaceResult: AccountResult<AdminInterface> =
        AccountResult.Success(adminInterface().copy(publicKey = "rotated-key"))

    var groupListResult: AccountResult<List<AdminGroup>> =
        AccountResult.Success(listOf(adminGroup()))
    var createGroupResult: AccountResult<AdminGroup> = AccountResult.Success(adminGroup())
    var updateGroupResult: AccountResult<AdminGroup> = AccountResult.Success(adminGroup())
    var deleteGroupResult: AccountResult<Unit> = AccountResult.Success(Unit)

    var poolListResult: AccountResult<List<AdminPool>> = AccountResult.Success(listOf(adminPool()))
    var createPoolResult: AccountResult<AdminPool> = AccountResult.Success(adminPool())
    var updatePoolResult: AccountResult<AdminPool> = AccountResult.Success(adminPool())
    var deletePoolResult: AccountResult<Unit> = AccountResult.Success(Unit)

    val createdNodes = mutableListOf<AdminNodeDraft>()
    val deletedNodes = mutableListOf<String>()
    val rotatedNodes = mutableListOf<String>()
    val createdInterfaces = mutableListOf<AdminInterfaceDraft>()
    val updatedInterfaces = mutableListOf<Pair<String, AdminInterfaceUpdate>>()
    val deletedInterfaces = mutableListOf<String>()
    val rotatedInterfaces = mutableListOf<String>()
    val createdGroups = mutableListOf<AdminGroupDraft>()
    val updatedGroups = mutableListOf<Pair<String, AdminGroupDraft>>()
    val deletedGroups = mutableListOf<String>()
    val createdPools = mutableListOf<Pair<String, AdminPoolDraft>>()
    val updatedPools = mutableListOf<Pair<String, AdminPoolUpdate>>()
    val deletedPools = mutableListOf<String>()

    val createdUsers = mutableListOf<AdminUserDraft>()
    val updatedUsers = mutableListOf<Pair<String, AdminUserDraft>>()
    val deletedUsers = mutableListOf<String>()
    val resetPasswords = mutableListOf<Pair<String, String>>()
    val approvals = mutableListOf<ApprovalCall>()
    val rejected = mutableListOf<String>()
    val createdTariffs = mutableListOf<AdminTariffDraft>()
    val updatedTariffs = mutableListOf<Pair<String, AdminTariffDraft>>()
    val deletedTariffs = mutableListOf<String>()
    var dashboardCalls = 0

    override suspend fun pageUsers(query: AdminUserQuery): AccountResult<Page<AdminUser>> {
        queries += query
        return pageHandler?.invoke(query) ?: pageResult
    }

    override suspend fun pendingUsers(): AccountResult<List<AdminUser>> = pendingResult

    override suspend fun user(id: String): AccountResult<AdminUser> = userResult

    override suspend fun createUser(draft: AdminUserDraft): AccountResult<AdminUser> {
        createdUsers += draft
        return createUserResult
    }

    override suspend fun updateUser(
        id: String,
        draft: AdminUserDraft,
    ): AccountResult<AdminUser> {
        updatedUsers += id to draft
        return updateUserResult
    }

    override suspend fun deleteUser(id: String): AccountResult<Unit> {
        deletedUsers += id
        return deleteUserResult
    }

    override suspend fun resetPassword(id: String, newPassword: String): AccountResult<Unit> {
        resetPasswords += id to newPassword
        return resetPasswordResult
    }

    override suspend fun approveUser(
        id: String,
        tariffId: String,
        nodeId: String?,
        groupId: String?,
    ): AccountResult<AdminUser> {
        approvals += ApprovalCall(id, tariffId, nodeId, groupId)
        return approveResult
    }

    override suspend fun rejectUser(id: String): AccountResult<AdminUser> {
        rejected += id
        return rejectResult
    }

    override suspend fun listTariffs(): AccountResult<List<AdminTariff>> = listTariffsResult

    override suspend fun createTariff(draft: AdminTariffDraft): AccountResult<AdminTariff> {
        createdTariffs += draft
        return createTariffResult
    }

    override suspend fun updateTariff(
        id: String,
        draft: AdminTariffDraft,
    ): AccountResult<AdminTariff> {
        updatedTariffs += id to draft
        return updateTariffResult
    }

    override suspend fun deleteTariff(id: String): AccountResult<Unit> {
        deletedTariffs += id
        return deleteTariffResult
    }

    override suspend fun dashboard(): AccountResult<AdminDashboard> {
        dashboardCalls++
        return dashboardResult
    }

    override suspend fun overview(): AccountResult<AdminOverview> {
        overviewCalls++
        return overviewResult
    }

    override suspend fun audit(query: AdminAuditQuery): AccountResult<AdminAuditPage> {
        auditQueries += query
        return auditHandler?.invoke(query) ?: auditResult
    }

    override suspend fun traffic(
        query: AdminStatsQuery,
    ): AccountResult<List<AdminTrafficPoint>> {
        trafficQueries += query
        return trafficHandler?.invoke(query) ?: trafficResult
    }

    override suspend fun quotaUsers(): AccountResult<List<AdminQuotaUser>> = quotaUsersResult

    override suspend fun settings(): AccountResult<AdminPanelSettings> {
        settingsCalls++
        return settingsResult
    }

    override suspend fun updateSettings(
        settings: AdminPanelSettings,
    ): AccountResult<AdminPanelSettings> {
        settingsUpdates += settings
        return updateSettingsResult ?: AccountResult.Success(settings)
    }

    override suspend fun listNodes(): AccountResult<List<AdminOption>> = nodesResult

    override suspend fun listGroups(): AccountResult<List<AdminOption>> = groupsResult

    override suspend fun listInterfaces(): AccountResult<List<AdminOption>> = interfacesResult

    override suspend fun nodes(): AccountResult<List<AdminNode>> = nodeListResult

    override suspend fun createNode(draft: AdminNodeDraft): AccountResult<AdminNodeSecret> {
        createdNodes += draft
        return createNodeResult
    }

    override suspend fun deleteNode(id: String): AccountResult<Unit> {
        deletedNodes += id
        return deleteNodeResult
    }

    override suspend fun rotateNodeToken(id: String): AccountResult<AdminNodeSecret> {
        rotatedNodes += id
        return rotateNodeResult
    }

    override suspend fun interfaces(): AccountResult<List<AdminInterface>> = interfaceListResult

    override suspend fun createInterface(
        draft: AdminInterfaceDraft,
    ): AccountResult<AdminInterface> {
        createdInterfaces += draft
        return createInterfaceResult
    }

    override suspend fun updateInterface(
        id: String,
        update: AdminInterfaceUpdate,
    ): AccountResult<AdminInterface> {
        updatedInterfaces += id to update
        return updateInterfaceResult
    }

    override suspend fun deleteInterface(id: String): AccountResult<Unit> {
        deletedInterfaces += id
        return deleteInterfaceResult
    }

    override suspend fun rotateInterface(id: String): AccountResult<AdminInterface> {
        rotatedInterfaces += id
        return rotateInterfaceResult
    }

    override suspend fun groups(): AccountResult<List<AdminGroup>> = groupListResult

    override suspend fun createGroup(draft: AdminGroupDraft): AccountResult<AdminGroup> {
        createdGroups += draft
        return createGroupResult
    }

    override suspend fun updateGroup(
        id: String,
        draft: AdminGroupDraft,
    ): AccountResult<AdminGroup> {
        updatedGroups += id to draft
        return updateGroupResult
    }

    override suspend fun deleteGroup(id: String): AccountResult<Unit> {
        deletedGroups += id
        return deleteGroupResult
    }

    override suspend fun pools(groupId: String): AccountResult<List<AdminPool>> = poolListResult

    override suspend fun createPool(
        groupId: String,
        draft: AdminPoolDraft,
    ): AccountResult<AdminPool> {
        createdPools += groupId to draft
        return createPoolResult
    }

    override suspend fun updatePool(id: String, update: AdminPoolUpdate): AccountResult<AdminPool> {
        updatedPools += id to update
        return updatePoolResult
    }

    override suspend fun deletePool(id: String): AccountResult<Unit> {
        deletedPools += id
        return deletePoolResult
    }
}

internal data class ApprovalCall(
    val id: String,
    val tariffId: String,
    val nodeId: String?,
    val groupId: String?,
)

internal class AdminTestEnvironment(
    val engine: MockEngine,
    val sessionManager: SessionManager,
    val api: AdminApi,
) {
    val requests: List<HttpRequestData>
        get() = engine.requestHistory
}

internal fun createAdminEnvironment(
    session: space.ivlev.umbravpn.domain.model.account.StoredSession? = storedSession(),
    handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
): AdminTestEnvironment {
    val engine = MockEngine { request -> handler(request) }
    val client =
        HttpClient(engine) {
            install(ContentNegotiation) { json(testJson) }
            expectSuccess = false
        }
    val sessionManager = SessionManager(InMemoryTokenStore(session))
    val api =
        AdminApi(
            client = client,
            json = testJson,
            sessionManager = sessionManager,
            settings = FakeAccountSettingsRepository(),
        )
    return AdminTestEnvironment(engine = engine, sessionManager = sessionManager, api = api)
}

internal fun MockRequestHandleScope.adminJson(
    status: HttpStatusCode,
    body: String,
): HttpResponseData = respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

internal fun adminUserJson(
    id: String = "user-1",
    email: String = "alice@example.com",
    fullName: String? = "Alice Ivanova",
    status: String = "active",
    role: String = "user",
    disabled: Boolean = false,
): String {
    val fullNameLine = fullName?.let { "\"full_name\": \"$it\"," } ?: ""
    return """
    {
      "id": "$id",
      "email": "$email",
      $fullNameLine
      "status": "$status",
      "totp_enabled": false,
      "role": "$role",
      "tariff_id": "tariff-1",
      "group_id": "group-1",
      "node_id": "node-1",
      "disabled": $disabled,
      "created_at": "2026-01-01T10:00:00Z",
      "updated_at": "2026-01-02T11:30:00Z"
    }
    """
        .trimIndent()
}

internal fun adminUserPageJson(
    items: List<String>,
    total: Int = items.size,
    limit: Int = 20,
    offset: Int = 0,
): String =
    """
    {
      "items": [${items.joinToString(",")}],
      "total": $total,
      "limit": $limit,
      "offset": $offset
    }
    """
        .trimIndent()

internal fun adminTariffJson(
    id: String = "tariff-1",
    name: String = "Standard",
    interfaceId: String? = "iface-1",
    interfaceName: String? = "awg0",
): String {
    val interfaceIdValue = interfaceId?.let { "\"$it\"" } ?: "null"
    val interfaceNameValue = interfaceName?.let { "\"$it\"" } ?: "null"
    return """
    {
      "id": "$id",
      "name": "$name",
      "description": "Five devices",
      "max_devices": 5,
      "device_down_kbps": 100000,
      "device_up_kbps": 50000,
      "group_down_kbps": 0,
      "group_up_kbps": 0,
      "traffic_quota_bytes": 107374182400,
      "interface_id": $interfaceIdValue,
      "interface_name": $interfaceNameValue,
      "created_at": "2026-01-01T10:00:00Z",
      "updated_at": "2026-01-02T11:30:00Z"
    }
    """
        .trimIndent()
}

internal fun adminOverviewJson(
    users: Int = 12,
    devices: Int = 34,
    nodesOnline: Int = 2,
    nodesTotal: Int = 3,
    interfaces: Int = 5,
    groups: Int = 2,
): String =
    """
    {
      "today": {"rx": 0, "tx": 0},
      "month": {"rx": 0, "tx": 0},
      "rx_bps": 0.0,
      "tx_bps": 0.0,
      "nodes_online": $nodesOnline,
      "nodes_total": $nodesTotal,
      "interfaces": $interfaces,
      "groups": $groups,
      "devices": $devices,
      "users": $users,
      "top_devices": []
    }
    """
        .trimIndent()
