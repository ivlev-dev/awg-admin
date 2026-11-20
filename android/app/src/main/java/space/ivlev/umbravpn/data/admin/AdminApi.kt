package space.ivlev.umbravpn.data.admin

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.ivlev.umbravpn.data.account.AuthResponseDto
import space.ivlev.umbravpn.data.account.IDEMPOTENCY_KEY_HEADER
import space.ivlev.umbravpn.data.account.PageDto
import space.ivlev.umbravpn.data.account.RefreshRequestDto
import space.ivlev.umbravpn.data.account.SessionManager
import space.ivlev.umbravpn.data.account.UserDto
import space.ivlev.umbravpn.data.account.mapApiError
import space.ivlev.umbravpn.data.account.toDomain
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.StoredSession
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
import space.ivlev.umbravpn.domain.model.admin.AdminRoleFilter
import space.ivlev.umbravpn.domain.model.admin.AdminStatusFilter
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminTariffDraft
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.domain.model.admin.AdminUserDraft
import space.ivlev.umbravpn.domain.model.admin.AdminUserQuery
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository

class AdminApi(
    private val client: HttpClient,
    private val json: Json,
    private val sessionManager: SessionManager,
    private val settings: AccountSettingsRepository,
    private val nowEpochSeconds: () -> Long = { Instant.now().epochSecond },
) {
    private val refreshMutex = Mutex()

    suspend fun pageUsers(query: AdminUserQuery): AccountResult<Page<AdminUser>> =
        execute(
            method = HttpMethod.Get,
            path = "users/page",
            configure = {
                parameter("limit", query.limit)
                parameter("offset", query.offset)
                if (query.query.isNotBlank()) parameter("q", query.query.trim())
                parameter("tab", query.tab.apiValue)
                if (query.role != AdminRoleFilter.All) parameter("role", query.role.apiValue)
                if (query.status != AdminStatusFilter.All) {
                    parameter("status", query.status.apiValue)
                }
            },
            decode = { body -> json.decodeFromString<PageDto<UserDto>>(body).toAdminPage() },
        )

    suspend fun pendingUsers(): AccountResult<List<AdminUser>> =
        execute(
            method = HttpMethod.Get,
            path = "users/pending",
            decode = { body ->
                json.decodeFromString<List<UserDto>>(body).map(UserDto::toAdminUser)
            },
        )

    suspend fun user(id: String): AccountResult<AdminUser> =
        execute(
            method = HttpMethod.Get,
            path = "users/$id",
            decode = { body -> json.decodeFromString<UserDto>(body).toAdminUser() },
        )

    suspend fun createUser(
        draft: AdminUserDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminUser> =
        execute(
            method = HttpMethod.Post,
            path = "users",
            idempotencyKey = idempotencyKey,
            body = createUserBody(draft).toString(),
            decode = { body -> json.decodeFromString<UserDto>(body).toAdminUser() },
        )

    suspend fun updateUser(
        id: String,
        draft: AdminUserDraft,
    ): AccountResult<AdminUser> =
        execute(
            method = HttpMethod.Patch,
            path = "users/$id",
            body = updateUserBody(draft).toString(),
            decode = { body -> json.decodeFromString<UserDto>(body).toAdminUser() },
        )

    suspend fun deleteUser(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "users/$id")

    suspend fun resetPassword(
        id: String,
        newPassword: String,
        idempotencyKey: String? = null,
    ): AccountResult<Unit> =
        executeUnit(
            method = HttpMethod.Post,
            path = "users/$id/password",
            idempotencyKey = idempotencyKey,
            body = buildJsonObject {
                    put("new_password", newPassword)
                }
                    .toString(),
        )

    suspend fun approveUser(
        id: String,
        tariffId: String,
        nodeId: String? = null,
        groupId: String? = null,
        idempotencyKey: String? = null,
    ): AccountResult<AdminUser> =
        execute(
            method = HttpMethod.Post,
            path = "users/$id/approve",
            idempotencyKey = idempotencyKey,
            body = buildJsonObject {
                    put("tariff_id", tariffId)
                    if (groupId != null) put("group_id", groupId)
                    if (nodeId != null) put("node_id", nodeId)
                }
                    .toString(),
            decode = { body -> json.decodeFromString<UserDto>(body).toAdminUser() },
        )

    suspend fun rejectUser(
        id: String,
        idempotencyKey: String? = null,
    ): AccountResult<AdminUser> =
        execute(
            method = HttpMethod.Post,
            path = "users/$id/reject",
            idempotencyKey = idempotencyKey,
            body = "{}",
            decode = { body -> json.decodeFromString<UserDto>(body).toAdminUser() },
        )

    suspend fun listTariffs(): AccountResult<List<AdminTariff>> =
        execute(
            method = HttpMethod.Get,
            path = "tariffs",
            decode = { body ->
                json.decodeFromString<List<AdminTariffDto>>(body).map(AdminTariffDto::toDomain)
            },
        )

    suspend fun createTariff(
        draft: AdminTariffDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminTariff> =
        execute(
            method = HttpMethod.Post,
            path = "tariffs",
            idempotencyKey = idempotencyKey,
            body = tariffBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminTariffDto>(body).toDomain() },
        )

    suspend fun updateTariff(
        id: String,
        draft: AdminTariffDraft,
    ): AccountResult<AdminTariff> =
        execute(
            method = HttpMethod.Patch,
            path = "tariffs/$id",
            body = tariffBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminTariffDto>(body).toDomain() },
        )

    suspend fun deleteTariff(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "tariffs/$id")

    suspend fun overview(): AccountResult<AdminOverview> =
        execute(
            method = HttpMethod.Get,
            path = "stats/overview",
            decode = { body -> json.decodeFromString<AdminOverviewDto>(body).toDomain() },
        )

    suspend fun audit(query: AdminAuditQuery): AccountResult<AdminAuditPage> =
        execute(
            method = HttpMethod.Get,
            path = "audit",
            configure = {
                parameter("limit", query.limit)
                query.before?.takeIf { it.isNotBlank() }?.let { parameter("before", it) }
                query.actor.trim().takeIf { it.isNotEmpty() }?.let { parameter("actor", it) }
                query.action.trim().takeIf { it.isNotEmpty() }?.let { parameter("action", it) }
                query.entity.trim().takeIf { it.isNotEmpty() }?.let { parameter("entity", it) }
                query.from?.let { parameter("from", it.epochSecond) }
                query.to?.let { parameter("to", it.epochSecond) }
            },
            decode = { body -> json.decodeFromString<AdminAuditPageDto>(body).toDomain() },
        )

    suspend fun trafficSeries(
        scope: String,
        from: Instant,
        to: Instant,
    ): AccountResult<List<AdminTrafficPoint>> =
        execute(
            method = HttpMethod.Get,
            path = "stats/series",
            configure = {
                parameter("scope", scope)
                parameter("from", from.epochSecond)
                parameter("to", to.epochSecond)
            },
            decode = { body ->
                json
                    .decodeFromString<List<AdminSeriesPointDto>>(body)
                    .map(AdminSeriesPointDto::toDomain)
            },
        )

    suspend fun trafficAggregate(
        scope: String,
        bucket: String,
        from: Instant,
        to: Instant,
    ): AccountResult<List<AdminTrafficPoint>> =
        execute(
            method = HttpMethod.Get,
            path = "stats/aggregate",
            configure = {
                parameter("scope", scope)
                parameter("bucket", bucket)
                parameter("from", from.epochSecond)
                parameter("to", to.epochSecond)
            },
            decode = { body ->
                json
                    .decodeFromString<AdminAggregateDto>(body)
                    .points
                    .map(AdminStatsPointDto::toDomain)
            },
        )

    suspend fun quotaUsers(): AccountResult<List<AdminQuotaUser>> =
        execute(
            method = HttpMethod.Get,
            path = "quota/users",
            decode = { body ->
                json
                    .decodeFromString<List<AdminQuotaUserDto>>(body)
                    .map(AdminQuotaUserDto::toDomain)
            },
        )

    suspend fun settings(): AccountResult<AdminPanelSettings> =
        execute(
            method = HttpMethod.Get,
            path = "settings",
            decode = { body -> json.decodeFromString<AdminSettingsDto>(body).toDomain() },
        )

    suspend fun updateSettings(settings: AdminPanelSettings): AccountResult<AdminPanelSettings> =
        execute(
            method = HttpMethod.Put,
            path = "settings",
            body = settingsBody(settings).toString(),
            decode = { body -> json.decodeFromString<AdminSettingsDto>(body).toDomain() },
        )

    suspend fun dashboard(): AccountResult<AdminDashboard> {
        val overview =
            when (val result = overview()) {
                is AccountResult.Success -> result.value
                is AccountResult.Failure -> return result
            }
        val pending =
            when (val result = pageUsers(AdminUserQuery(limit = 1, tab = AdminUserTab.Pending))) {
                is AccountResult.Success -> result.value.total
                is AccountResult.Failure -> 0
            }
        return AccountResult.Success(AdminDashboard(overview = overview, pendingUsers = pending))
    }

    suspend fun listNodes(): AccountResult<List<AdminOption>> =
        execute(
            method = HttpMethod.Get,
            path = "nodes",
            decode = { body ->
                json.decodeFromString<List<AdminNodeDto>>(body).map {
                    AdminOption(it.id, it.name.ifBlank { it.id })
                }
            },
        )

    suspend fun listGroups(): AccountResult<List<AdminOption>> =
        execute(
            method = HttpMethod.Get,
            path = "groups",
            decode = { body ->
                json.decodeFromString<List<AdminGroupDto>>(body).map(AdminGroupDto::toOption)
            },
        )

    suspend fun listInterfaces(): AccountResult<List<AdminOption>> =
        execute(
            method = HttpMethod.Get,
            path = "interfaces",
            decode = { body ->
                json
                    .decodeFromString<List<AdminInterfaceOptionDto>>(body)
                    .map(
                        AdminInterfaceOptionDto::toOption,
                    )
            },
        )

    suspend fun nodes(): AccountResult<List<AdminNode>> =
        execute(
            method = HttpMethod.Get,
            path = "nodes",
            decode = { body ->
                json.decodeFromString<List<AdminNodeDto>>(body).map(AdminNodeDto::toDomain)
            },
        )

    suspend fun createNode(
        draft: AdminNodeDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminNodeSecret> =
        execute(
            method = HttpMethod.Post,
            path = "nodes",
            idempotencyKey = idempotencyKey,
            body = buildJsonObject { put("name", draft.name.trim()) }.toString(),
            decode = { body ->
                val created = json.decodeFromString<AdminNodeCreateDto>(body)
                AdminNodeSecret(
                    nodeId = created.node.id,
                    nodeName = created.node.name.ifBlank { created.node.id },
                    token = created.token,
                )
            },
        )

    suspend fun deleteNode(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "nodes/$id")

    suspend fun rotateNodeToken(
        id: String,
        idempotencyKey: String? = null,
    ): AccountResult<AdminNodeSecret> =
        execute(
            method = HttpMethod.Post,
            path = "nodes/$id/rotate",
            idempotencyKey = idempotencyKey,
            decode = { body ->
                val rotated = json.decodeFromString<AdminNodeRotateDto>(body)
                AdminNodeSecret(
                    nodeId = rotated.node.id,
                    nodeName = rotated.node.name.ifBlank { rotated.node.id },
                    token = rotated.token,
                )
            },
        )

    suspend fun interfaces(): AccountResult<List<AdminInterface>> =
        execute(
            method = HttpMethod.Get,
            path = "interfaces",
            decode = { body ->
                json
                    .decodeFromString<List<AdminInterfaceDto>>(body)
                    .map(AdminInterfaceDto::toDomain)
            },
        )

    suspend fun createInterface(
        draft: AdminInterfaceDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminInterface> =
        execute(
            method = HttpMethod.Post,
            path = "interfaces",
            idempotencyKey = idempotencyKey,
            body = createInterfaceBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminInterfaceDto>(body).toDomain() },
        )

    suspend fun updateInterface(
        id: String,
        update: AdminInterfaceUpdate,
    ): AccountResult<AdminInterface> =
        execute(
            method = HttpMethod.Patch,
            path = "interfaces/$id",
            body = updateInterfaceBody(update).toString(),
            decode = { body -> json.decodeFromString<AdminInterfaceDto>(body).toDomain() },
        )

    suspend fun deleteInterface(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "interfaces/$id")

    suspend fun rotateInterface(
        id: String,
        idempotencyKey: String? = null,
    ): AccountResult<AdminInterface> =
        execute(
            method = HttpMethod.Post,
            path = "interfaces/$id/rotate",
            idempotencyKey = idempotencyKey,
            decode = { body -> json.decodeFromString<AdminInterfaceDto>(body).toDomain() },
        )

    suspend fun groups(): AccountResult<List<AdminGroup>> =
        execute(
            method = HttpMethod.Get,
            path = "groups",
            decode = { body ->
                json
                    .decodeFromString<List<AdminGroupViewDto>>(body)
                    .map(AdminGroupViewDto::toDomain)
            },
        )

    suspend fun createGroup(
        draft: AdminGroupDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminGroup> =
        execute(
            method = HttpMethod.Post,
            path = "groups",
            idempotencyKey = idempotencyKey,
            body = groupBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminGroupViewDto>(body).toDomain() },
        )

    suspend fun updateGroup(
        id: String,
        draft: AdminGroupDraft,
    ): AccountResult<AdminGroup> =
        execute(
            method = HttpMethod.Patch,
            path = "groups/$id",
            body = groupBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminGroupViewDto>(body).toDomain() },
        )

    suspend fun deleteGroup(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "groups/$id")

    suspend fun pools(groupId: String): AccountResult<List<AdminPool>> =
        execute(
            method = HttpMethod.Get,
            path = "groups/$groupId/pools",
            decode = { body ->
                json.decodeFromString<List<AdminPoolDto>>(body).map(AdminPoolDto::toDomain)
            },
        )

    suspend fun createPool(
        groupId: String,
        draft: AdminPoolDraft,
        idempotencyKey: String? = null,
    ): AccountResult<AdminPool> =
        execute(
            method = HttpMethod.Post,
            path = "groups/$groupId/pools",
            idempotencyKey = idempotencyKey,
            body = createPoolBody(draft).toString(),
            decode = { body -> json.decodeFromString<AdminPoolDto>(body).toDomain() },
        )

    suspend fun updatePool(
        id: String,
        update: AdminPoolUpdate,
    ): AccountResult<AdminPool> =
        execute(
            method = HttpMethod.Patch,
            path = "pools/$id",
            body = updatePoolBody(update).toString(),
            decode = { body -> json.decodeFromString<AdminPoolDto>(body).toDomain() },
        )

    suspend fun deletePool(id: String): AccountResult<Unit> =
        executeUnit(method = HttpMethod.Delete, path = "pools/$id")

    private fun createUserBody(draft: AdminUserDraft): JsonObject = buildJsonObject {
        put("email", draft.email.trim())
        put(
            "full_name",
            draft.fullName?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull,
        )
        put("role", draft.role.apiValue)
        put("tariff_id", draft.tariffId?.let(::JsonPrimitive) ?: JsonNull)
        put("group_id", draft.groupId?.let(::JsonPrimitive) ?: JsonNull)
        put("node_id", draft.nodeId?.let(::JsonPrimitive) ?: JsonNull)
        draft.password?.takeIf { it.isNotBlank() }?.let { put("password", it) }
    }

    private fun updateUserBody(draft: AdminUserDraft): JsonObject = buildJsonObject {
        put("email", draft.email.trim())
        put(
            "full_name",
            draft.fullName?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull,
        )
        put("role", draft.role.apiValue)
        put("tariff_id", draft.tariffId?.let(::JsonPrimitive) ?: JsonNull)
        put("group_id", draft.groupId?.let(::JsonPrimitive) ?: JsonNull)
        put("node_id", draft.nodeId?.let(::JsonPrimitive) ?: JsonNull)
        put("disabled", draft.disabled)
    }

    private fun tariffBody(draft: AdminTariffDraft): JsonObject = buildJsonObject {
        put("name", draft.name.trim())
        put("description", draft.description.trim())
        put("max_devices", draft.maxDevices)
        put("device_down_kbps", draft.deviceDownKbps)
        put("device_up_kbps", draft.deviceUpKbps)
        put(
            "traffic_quota_bytes",
            draft.trafficQuotaBytes?.let(::JsonPrimitive) ?: JsonNull,
        )
        put("interface_id", draft.interfaceId?.let(::JsonPrimitive) ?: JsonNull)
    }

    private fun createInterfaceBody(draft: AdminInterfaceDraft): JsonObject = buildJsonObject {
        put("group_id", draft.groupId)
        put("node_id", draft.nodeId)
        put("name", draft.name.trim())
        put("label", draft.label.trim())
        put("endpoint_host", draft.endpointHost.trim())
        put("endpoint_port", draft.endpointPort)
        put("listen_port", draft.listenPort)
        put("mtu", draft.mtu)
    }

    private fun updateInterfaceBody(update: AdminInterfaceUpdate): JsonObject = buildJsonObject {
        put("label", update.label.trim())
        put("endpoint_host", update.endpointHost.trim())
        put("endpoint_port", update.endpointPort)
        put("listen_port", update.listenPort)
        put("mtu", update.mtu)
        put("enabled", update.enabled)
    }

    private fun groupBody(draft: AdminGroupDraft): JsonObject = buildJsonObject {
        put("name", draft.name.trim())
        put("description", draft.description.trim())
        put("base_cidr", draft.baseCidr.trim())
        put("forwarding_default", draft.forwardingDefault)
    }

    private fun createPoolBody(draft: AdminPoolDraft): JsonObject = buildJsonObject {
        put("name", draft.name.trim())
        put("cidr", draft.cidr.trim())
        put("mode", draft.mode.apiValue)
        put(
            "gateway",
            draft.gateway?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull,
        )
    }

    private fun updatePoolBody(update: AdminPoolUpdate): JsonObject = buildJsonObject {
        put("mode", update.mode.apiValue)
        put(
            "gateway",
            update.gateway?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull,
        )
        put("enabled", update.enabled)
    }

    private fun settingsBody(settings: AdminPanelSettings): JsonObject {
        val obfuscation = settings.obfuscation
        val obfuscationBody = buildJsonObject {
            put("profile", obfuscation.profile.apiValue)
            put("intensity", obfuscation.intensity.apiValue)
            put("browser", obfuscation.browser.apiValue)
            put("mtu", obfuscation.mtu)
            put("jc_min", obfuscation.jcMin)
            put("jc_max", obfuscation.jcMax)
            put("jmin_min", obfuscation.jminMin)
            put("jmin_max", obfuscation.jminMax)
            put("jmax_extra_min", obfuscation.jmaxExtraMin)
            put("jmax_extra_max", obfuscation.jmaxExtraMax)
            put("s_min", obfuscation.sMin)
            put("s_max", obfuscation.sMax)
            put(
                "hosts",
                kotlinx.serialization.json.JsonArray(obfuscation.hosts.map(::JsonPrimitive)),
            )
            put("random_trailers", obfuscation.randomTrailers)
            put("disable_cookies", obfuscation.disableCookies)
            put("keepalive_min", obfuscation.keepaliveMin)
            put("keepalive_max", obfuscation.keepaliveMax)
        }
        return buildJsonObject {
            put("obfuscation", obfuscationBody)
            put("share_default_ttl_secs", settings.shareDefaultTtlSecs)
            put("stats_retention_days", settings.statsRetentionDays)
        }
    }

    private suspend fun executeUnit(
        method: HttpMethod,
        path: String,
        idempotencyKey: String? = null,
        body: String? = null,
    ): AccountResult<Unit> =
        execute(
            method = method,
            path = path,
            idempotencyKey = idempotencyKey,
            body = body,
            decode = {},
        )

    private suspend fun <T> execute(
        method: HttpMethod,
        path: String,
        idempotencyKey: String? = null,
        body: String? = null,
        configure: io.ktor.client.request.HttpRequestBuilder.() -> Unit = {},
        decode: (body: String) -> T,
    ): AccountResult<T> {
        val baseUrl = settings.serverUrl()
        if (baseUrl.isBlank()) {
            return AccountResult.Failure(AccountError.ServerNotConfigured)
        }

        val session = sessionManager.currentSession()
        if (session == null) {
            sessionManager.markExpired()
            return AccountResult.Failure(AccountError.SessionExpired)
        }

        val requestKey = idempotencyKeyFor(method, idempotencyKey)

        suspend fun send(token: String): HttpResponse? =
            sendOrNetwork(baseUrl, method, path, token, requestKey, body, configure)

        val first = send(session.accessToken) ?: return AccountResult.Failure(AccountError.Network)

        if (first.status == HttpStatusCode.Unauthorized) {
            return when (val outcome = refresh(baseUrl, session.accessToken)) {
                RefreshOutcome.Expired -> {
                    sessionManager.markExpired()
                    AccountResult.Failure(AccountError.SessionExpired)
                }
                RefreshOutcome.NetworkFailure -> AccountResult.Failure(AccountError.Network)
                is RefreshOutcome.Refreshed -> {
                    val retry =
                        send(outcome.accessToken)
                            ?: return AccountResult.Failure(AccountError.Network)
                    if (retry.status == HttpStatusCode.Unauthorized) {
                        sessionManager.markExpired()
                        return AccountResult.Failure(AccountError.SessionExpired)
                    }
                    parse(retry, decode)
                }
            }
        }

        return parse(first, decode)
    }

    private suspend fun refresh(baseUrl: String, failedAccessToken: String): RefreshOutcome =
        refreshMutex.withLock {
            val stored = sessionManager.currentSession() ?: return@withLock RefreshOutcome.Expired
            if (stored.accessToken != failedAccessToken) {
                return@withLock RefreshOutcome.Refreshed(stored.accessToken)
            }
            if (stored.refreshToken.isBlank()) {
                return@withLock RefreshOutcome.Expired
            }

            val response =
                try {
                    client.post(endpoint(baseUrl, "auth/refresh")) {
                        contentType(ContentType.Application.Json)
                        setBody(RefreshRequestDto(refreshToken = stored.refreshToken))
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    return@withLock RefreshOutcome.NetworkFailure
                }

            val responseBody =
                try {
                    response.bodyAsText()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    return@withLock RefreshOutcome.NetworkFailure
                }

            if (!response.status.isSuccess()) {
                val status = response.status.value
                val expired = status == 400 || status == 401 || status == 403
                return@withLock if (expired) RefreshOutcome.Expired
                else RefreshOutcome.NetworkFailure
            }

            val auth =
                runCatching { json.decodeFromString<AuthResponseDto>(responseBody) }.getOrNull()
                    ?: return@withLock RefreshOutcome.Expired
            persist(auth)
            RefreshOutcome.Refreshed(auth.token)
        }

    private suspend fun sendOrNetwork(
        baseUrl: String,
        method: HttpMethod,
        path: String,
        accessToken: String,
        idempotencyKey: String?,
        body: String?,
        configure: io.ktor.client.request.HttpRequestBuilder.() -> Unit,
    ): HttpResponse? =
        try {
            client.request(endpoint(baseUrl, path)) {
                this.method = method
                header(HttpHeaders.Authorization, "Bearer $accessToken")
                if (!idempotencyKey.isNullOrBlank()) {
                    header(IDEMPOTENCY_KEY_HEADER, idempotencyKey)
                }
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
                configure()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }

    private fun idempotencyKeyFor(method: HttpMethod, explicitKey: String?): String? =
        when {
            method != HttpMethod.Post -> null
            !explicitKey.isNullOrBlank() -> explicitKey
            else -> UUID.randomUUID().toString()
        }

    private suspend fun <T> parse(
        response: HttpResponse,
        decode: (body: String) -> T,
    ): AccountResult<T> {
        val body =
            try {
                response.bodyAsText()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return AccountResult.Failure(AccountError.Network)
            }

        if (!response.status.isSuccess()) {
            return AccountResult.Failure(mapApiError(response.status.value, body))
        }

        return try {
            AccountResult.Success(decode(body))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AccountResult.Failure(AccountError.Unexpected(e.message))
        }
    }

    private fun persist(auth: AuthResponseDto) {
        sessionManager.onAuthenticated(
            session =
                StoredSession(
                    accessToken = auth.token,
                    refreshToken = auth.refreshToken,
                    expiresAtEpochSeconds = nowEpochSeconds() + auth.expiresIn,
                    userId = auth.user.id,
                    email = auth.user.email,
                ),
            user = auth.user.toDomain(),
        )
    }

    private sealed interface RefreshOutcome {
        data class Refreshed(val accessToken: String) : RefreshOutcome

        data object Expired : RefreshOutcome

        data object NetworkFailure : RefreshOutcome
    }
}

private fun PageDto<UserDto>.toAdminPage(): Page<AdminUser> =
    Page(
        items = items.map(UserDto::toAdminUser),
        total = total,
        limit = limit,
        offset = offset,
    )

private fun endpoint(baseUrl: String, path: String): String = "$baseUrl/api/v1/$path"
