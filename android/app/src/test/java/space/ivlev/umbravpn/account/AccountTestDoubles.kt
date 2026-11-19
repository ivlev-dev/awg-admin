package space.ivlev.umbravpn.account

import java.time.Instant
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnectPort
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.data.account.AccountSnapshotCache
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AccountTariff
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.account.pageDevices
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.domain.sync.SyncEvent
import space.ivlev.umbravpn.domain.sync.SyncResult
import space.ivlev.umbravpn.sync.FakeManagedTunnelRepository
import space.ivlev.umbravpn.sync.InMemoryTunnelRepository
import space.ivlev.umbravpn.viewmodel.AccountViewModel

internal fun testUser(
    email: String = "alice@example.com",
    fullName: String? = "Alice Ivanova",
    status: UserStatus = UserStatus.Active,
): AuthUser =
    AuthUser(
        id = "user-1",
        email = email,
        fullName = fullName,
        status = status,
        totpEnabled = false,
        role = UserRole.User,
        tariffId = "tariff-1",
        nodeId = "node-1",
    )

internal fun testDevice(
    id: String = "device-1",
    name: String = "Pixel",
    revoked: Boolean = false,
    peers: List<DevicePeer> = emptyList(),
): AccountDevice =
    AccountDevice(
        id = id,
        userId = "user-1",
        groupId = "group-1",
        interfaceId = "iface-1",
        interfaceName = "awg0",
        nodeId = "node-1",
        nodeName = "Frankfurt",
        name = name,
        downKbps = 0,
        upKbps = 0,
        revoked = revoked,
        external = false,
        addresses = listOf("10.8.0.2/32"),
        peers = peers,
        createdAt = Instant.parse("2026-01-03T09:00:00Z"),
    )

internal fun testSnapshot(devices: List<AccountDevice> = listOf(testDevice())): AccountSnapshot =
    AccountSnapshot(
        user = testUser(),
        tariff =
            AccountTariff(
                id = "tariff-1",
                name = "Standard",
                description = "5 devices",
                maxDevices = 3,
                deviceDownKbps = 100_000,
                deviceUpKbps = 50_000,
                trafficQuotaBytes = 107_374_182_400L,
            ),
        quota =
            AccountQuota(
                usedBytes = 5_368_709_120L,
                quotaBytes = 107_374_182_400L,
                exceeded = false,
                remainingBytes = 102_005_473_280L,
                percent = 5.0,
                periodStart = Instant.parse("2026-01-01T00:00:00Z"),
                periodEnd = Instant.parse("2026-02-01T00:00:00Z"),
                resetAt = Instant.parse("2026-02-01T00:00:00Z"),
            ),
        devices = devices,
    )

internal class FakeAuthRepository : AuthRepository {
    override val session: StateFlow<SessionState> =
        MutableStateFlow<SessionState>(SessionState.LoggedOut)

    var loginResult: AccountResult<AuthUser> = AccountResult.Success(testUser())
    var registerResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var verifyResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var resendResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var forgotResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var resetResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var meResult: AccountResult<AuthUser> = AccountResult.Failure(AccountError.Unauthorized)
    var logoutResult: AccountResult<Unit> = AccountResult.Success(Unit)

    val logins = mutableListOf<Triple<String, String, String?>>()
    val registered = mutableListOf<RegisterCall>()
    val resentEmails = mutableListOf<String>()
    val forgotEmails = mutableListOf<String>()
    var resetCalls = 0
    var meCalls = 0
    var logoutCalls = 0

    override suspend fun login(
        email: String,
        password: String,
        totpCode: String?,
    ): AccountResult<AuthUser> {
        logins += Triple(email, password, totpCode)
        return loginResult
    }

    override suspend fun register(
        email: String,
        password: String,
        fullName: String?,
    ): AccountResult<Unit> {
        registered += RegisterCall(email, password, fullName)
        return registerResult
    }

    override suspend fun verifyEmail(token: String): AccountResult<Unit> = verifyResult

    override suspend fun resendVerification(email: String): AccountResult<Unit> {
        resentEmails += email
        return resendResult
    }

    override suspend fun forgotPassword(email: String): AccountResult<Unit> {
        forgotEmails += email
        return forgotResult
    }

    override suspend fun resetPassword(token: String, password: String): AccountResult<Unit> {
        resetCalls++
        return resetResult
    }

    override suspend fun me(): AccountResult<AuthUser> {
        meCalls++
        return meResult
    }

    override suspend fun logout(): AccountResult<Unit> {
        logoutCalls++
        return logoutResult
    }
}

internal class FakeAccountRepository : AccountRepository {
    var bootstrapResult: AccountResult<AccountSnapshot> = AccountResult.Success(testSnapshot())
    var createResult: AccountResult<CreatedDevice> =
        AccountResult.Success(
            CreatedDevice(
                device = testDevice(id = "device-new", name = "Laptop"),
                config =
                    DeviceConfig(
                        interfaceId = "iface-2",
                        interfaceName = "awg1",
                        nodeId = "node-1",
                        endpoint = "vpn.example.com:51820",
                        addresses = listOf("10.8.0.3/32"),
                        conf = "[Interface]",
                        revision = "rev",
                    ),
            ),
        )
    var renameResult: AccountResult<AccountDevice> =
        AccountResult.Success(testDevice(name = "Renamed"))
    var deleteResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var configResult: AccountResult<DeviceConfig> =
        AccountResult.Success(
            DeviceConfig(
                interfaceId = "iface-1",
                interfaceName = "awg0",
                nodeId = "node-1",
                endpoint = "vpn.example.com:51820",
                addresses = listOf("10.8.0.2/32"),
                conf = "[Interface]",
                revision = "rev",
            ),
        )

    val createdNames = mutableListOf<String>()
    val createdInterfaceIds = mutableListOf<List<String>>()
    val createdIdempotencyKeys = mutableListOf<String?>()
    val addedTunnels = mutableListOf<Triple<String, String, String?>>()
    val addedTunnelKeys = mutableListOf<String?>()
    val removedTunnels = mutableListOf<Pair<String, String>>()
    val renamed = mutableListOf<Pair<String, String>>()
    val deleted = mutableListOf<String>()
    var bootstrapCalls = 0

    var addTunnelResult: AccountResult<CreatedDevice> =
        AccountResult.Success(
            CreatedDevice(
                device = testDevice(name = "Renamed"),
                config =
                    DeviceConfig(
                        interfaceId = "iface-1",
                        interfaceName = "awg0",
                        nodeId = "node-1",
                        endpoint = "vpn.example.com:51820",
                        addresses = listOf("10.8.0.2/32"),
                        conf = "[Interface]",
                        revision = "rev",
                        peerId = "peer-2",
                        label = "awg0b",
                    ),
            ),
        )
    var removeTunnelResult: AccountResult<Unit> = AccountResult.Success(Unit)
    var renameTunnelResult: AccountResult<AccountDevice> =
        AccountResult.Success(testDevice(name = "Renamed"))
    val renamedTunnels = mutableListOf<Triple<String, String, String>>()
    val pageQueries = mutableListOf<DeviceQuery>()
    var pageResult: AccountResult<Page<AccountDevice>>? = null
    var pageHandler: ((DeviceQuery) -> AccountResult<Page<AccountDevice>>)? = null
    var updateFullNameResult: AccountResult<AuthUser> =
        AccountResult.Success(testUser(fullName = "Alice Ivanova"))
    val updatedFullNames = mutableListOf<String>()

    override suspend fun bootstrap(): AccountResult<AccountSnapshot> {
        bootstrapCalls++
        return bootstrapResult
    }

    override suspend fun pageDevices(
        limit: Int,
        offset: Int,
        query: String,
        status: DeviceStatusFilter,
    ): AccountResult<Page<AccountDevice>> {
        val request = DeviceQuery(limit = limit, offset = offset, query = query, status = status)
        pageQueries += request
        pageHandler?.let {
            return it(request)
        }
        pageResult?.let {
            return it
        }
        return when (val bootstrap = bootstrapResult) {
            is AccountResult.Success ->
                AccountResult.Success(bootstrap.value.devices.pageDevices(request))
            is AccountResult.Failure -> AccountResult.Failure(bootstrap.error)
        }
    }

    override suspend fun createDevice(
        name: String,
        interfaceIds: List<String>,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> {
        createdNames += name
        createdInterfaceIds += interfaceIds
        createdIdempotencyKeys += idempotencyKey
        return createResult
    }

    override suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> = configResult

    override suspend fun deviceConfigs(id: String): AccountResult<List<DeviceConfig>> =
        resultOf(configResult)

    private fun resultOf(result: AccountResult<DeviceConfig>): AccountResult<List<DeviceConfig>> =
        when (result) {
            is AccountResult.Success -> AccountResult.Success(listOf(result.value))
            is AccountResult.Failure -> result
        }

    override suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> {
        renamed += id to name
        return renameResult
    }

    override suspend fun addDeviceTunnel(
        deviceId: String,
        interfaceId: String,
        label: String?,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> {
        addedTunnels += Triple(deviceId, interfaceId, label)
        addedTunnelKeys += idempotencyKey
        return addTunnelResult
    }

    override suspend fun removeDeviceTunnel(
        deviceId: String,
        peerId: String,
    ): AccountResult<Unit> {
        removedTunnels += deviceId to peerId
        return removeTunnelResult
    }

    override suspend fun renameDeviceTunnel(
        deviceId: String,
        peerId: String,
        label: String,
    ): AccountResult<AccountDevice> {
        renamedTunnels += Triple(deviceId, peerId, label)
        return renameTunnelResult
    }

    override suspend fun deleteDevice(id: String): AccountResult<Unit> {
        deleted += id
        return deleteResult
    }

    override suspend fun updateFullName(fullName: String): AccountResult<AuthUser> {
        updatedFullNames += fullName
        return updateFullNameResult
    }
}

internal data class RegisterCall(
    val email: String,
    val password: String,
    val fullName: String?,
)

internal class AccountViewModelHarness(
    val repository: FakeAccountRepository = FakeAccountRepository(),
) {
    var syncCalls = 0
        private set

    fun build(): AccountViewModel {
        val syncService =
            object : ManagedTunnelSyncService {
                override val events = MutableSharedFlow<SyncEvent>()

                override suspend fun sync(): SyncResult {
                    syncCalls++
                    return SyncResult.Success()
                }
            }
        val cleaner =
            object : ManagedTunnelCleanup {
                override suspend fun clear() = Unit
            }
        val port =
            object : ManagedTunnelAutoConnectPort {
                override val activeTunnelIds: Set<Int> = emptySet()

                override fun hasVpnPermission(): Boolean = false

                override suspend fun startTunnel(tunnel: TunnelConfig): Boolean = false
            }
        val autoConnector =
            ManagedTunnelAutoConnector(
                session = MutableStateFlow<SessionState>(SessionState.LoggedOut),
                managedTunnelRepository = FakeManagedTunnelRepository(),
                tunnelRepository = InMemoryTunnelRepository(),
                port = port,
            )
        return AccountViewModel(
            authRepository = FakeAuthRepository(),
            settingsRepository = FakeAccountSettingsRepository(),
            accountActions = AccountActions(repository),
            syncService = syncService,
            logoutCoordinator =
                LogoutCoordinator(
                    stopTunnels = {},
                    tunnelCleanup = cleaner,
                    resetAutoConnect = {},
                    settingsRepository = FakeAccountSettingsRepository(),
                    authActions = AuthActions(FakeAuthRepository(), PendingSignupCache()),
                ),
            autoConnector = autoConnector,
            snapshotCache = AccountSnapshotCache(FakeAccountSettingsRepository()),
        )
    }
}
