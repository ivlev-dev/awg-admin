package space.ivlev.umbravpn.sync

import com.wgtunnel.parser.Config
import com.wgtunnel.parser.InterfaceSection
import com.wgtunnel.parser.PeerSection
import com.wgtunnel.parser.crypto.Key
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.account.FakeAccountSettingsRepository
import space.ivlev.umbravpn.data.sync.RemoteManagedTunnelSyncService
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.domain.model.account.ManagedTunnel
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.account.pageDevices
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService

internal val testUser: AuthUser =
    AuthUser(
        id = "user-1",
        login = "alice",
        email = "alice@example.com",
        status = UserStatus.Active,
        totpEnabled = false,
        role = UserRole.User,
    )

internal val activeSession: SessionState = SessionState.Active(testUser)

internal fun quickConfig(
    endpoint: String = "vpn.example.com:51820",
    address: String = "10.8.0.2/32",
): String =
    Config(
            `interface` =
                InterfaceSection(
                    address = address,
                    privateKey = Key.generatePrivateKey().toBase64(),
                ),
            peers =
                listOf(
                    PeerSection(
                        publicKey = Key.generatePrivateKey().toBase64(),
                        allowedIPs = "0.0.0.0/0",
                        endpoint = endpoint,
                    ),
                ),
        )
        .asQuickString()

internal fun normalizeQuickConfig(conf: String): String =
    Config.parseQuickString(conf).asQuickString()

internal fun accountDevice(
    id: String = "device-1",
    name: String = "Pixel",
    revoked: Boolean = false,
    interfaceId: String = "iface-1",
    peers: List<DevicePeer> = emptyList(),
): AccountDevice =
    AccountDevice(
        id = id,
        userId = "user-1",
        groupId = null,
        interfaceId = interfaceId,
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
        createdAt = null,
    )

internal fun deviceConfig(
    conf: String = quickConfig(),
    revision: String = "rev-1",
    endpoint: String = "vpn.example.com:51820",
    interfaceId: String = "iface-1",
    interfaceName: String = "awg0",
    peerId: String = "",
    label: String = "",
): DeviceConfig =
    DeviceConfig(
        interfaceId = interfaceId,
        interfaceName = interfaceName,
        nodeId = "node-1",
        endpoint = endpoint,
        addresses = listOf("10.8.0.2/32"),
        conf = conf,
        revision = revision,
        peerId = peerId,
        label = label,
    )

internal fun accountSnapshot(
    devices: List<AccountDevice> = listOf(accountDevice()),
): AccountSnapshot =
    AccountSnapshot(
        user = testUser,
        tariff = null,
        quota =
            AccountQuota(
                usedBytes = 0,
                quotaBytes = null,
                exceeded = false,
                remainingBytes = null,
                percent = null,
                periodStart = null,
                periodEnd = null,
                resetAt = null,
            ),
        devices = devices,
    )

internal class FakeAccountRepository(
    var bootstrapResult: AccountResult<AccountSnapshot>,
) : AccountRepository {
    var bootstrapCalls = 0
        private set

    val createdDeviceNames = mutableListOf<String>()
    val createdInterfaceIds = mutableListOf<List<String>>()
    var createDeviceResult: AccountResult<CreatedDevice>? = null
    val deviceConfigResults = mutableMapOf<String, AccountResult<DeviceConfig>>()
    val deviceConfigsResults = mutableMapOf<String, AccountResult<List<DeviceConfig>>>()
    var addTunnelResult: AccountResult<CreatedDevice>? = null
    var removeTunnelResult: AccountResult<Unit> = AccountResult.Success(Unit)
    val addedTunnels = mutableListOf<Triple<String, String, String?>>()
    val removedTunnels = mutableListOf<Pair<String, String>>()
    var deviceConfigsDelayMillis: Long = 0L
    private var activeDeviceConfigCalls = 0
    var maxConcurrentDeviceConfigCalls = 0
        private set

    override suspend fun bootstrap(): AccountResult<AccountSnapshot> {
        bootstrapCalls++
        return bootstrapResult
    }

    override suspend fun pageDevices(
        limit: Int,
        offset: Int,
        query: String,
        status: DeviceStatusFilter,
    ): AccountResult<Page<AccountDevice>> =
        when (val bootstrap = bootstrapResult) {
            is AccountResult.Success ->
                AccountResult.Success(
                    bootstrap.value.devices.pageDevices(
                        DeviceQuery(limit = limit, offset = offset, query = query, status = status),
                    ),
                )
            is AccountResult.Failure -> AccountResult.Failure(bootstrap.error)
        }

    override suspend fun createDevice(
        name: String,
        interfaceIds: List<String>,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> {
        createdDeviceNames += name
        createdInterfaceIds += interfaceIds
        return createDeviceResult
            ?: AccountResult.Failure(AccountError.Unexpected("createDevice not stubbed"))
    }

    override suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> =
        deviceConfigResults[id]
            ?: AccountResult.Failure(AccountError.Unexpected("no config for $id"))

    override suspend fun deviceConfigs(id: String): AccountResult<List<DeviceConfig>> {
        activeDeviceConfigCalls++
        if (activeDeviceConfigCalls > maxConcurrentDeviceConfigCalls) {
            maxConcurrentDeviceConfigCalls = activeDeviceConfigCalls
        }
        return try {
            if (deviceConfigsDelayMillis > 0) delay(deviceConfigsDelayMillis)
            deviceConfigsResults[id]
                ?: deviceConfigResults[id]?.let { result ->
                    when (result) {
                        is AccountResult.Success -> AccountResult.Success(listOf(result.value))
                        is AccountResult.Failure -> result
                    }
                }
                ?: AccountResult.Failure(AccountError.Unexpected("no configs for $id"))
        } finally {
            activeDeviceConfigCalls--
        }
    }

    override suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> =
        AccountResult.Failure(AccountError.Unexpected("renameDevice not supported"))

    override suspend fun addDeviceTunnel(
        deviceId: String,
        interfaceId: String,
        label: String?,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> {
        addedTunnels += Triple(deviceId, interfaceId, label)
        return addTunnelResult
            ?: AccountResult.Failure(AccountError.Unexpected("addDeviceTunnel not stubbed"))
    }

    override suspend fun removeDeviceTunnel(
        deviceId: String,
        peerId: String,
    ): AccountResult<Unit> {
        removedTunnels += deviceId to peerId
        return removeTunnelResult
    }

    var renameTunnelResult: AccountResult<AccountDevice> = AccountResult.Success(accountDevice())
    val renamedTunnels = mutableListOf<Triple<String, String, String>>()

    override suspend fun renameDeviceTunnel(
        deviceId: String,
        peerId: String,
        label: String,
    ): AccountResult<AccountDevice> {
        renamedTunnels += Triple(deviceId, peerId, label)
        return renameTunnelResult
    }

    override suspend fun deleteDevice(id: String): AccountResult<Unit> = AccountResult.Success(Unit)
}

internal class FakeManagedTunnelRepository(initial: List<ManagedTunnel> = emptyList()) :
    ManagedTunnelRepository {
    private val state = MutableStateFlow(initial)

    val bindings: List<ManagedTunnel>
        get() = state.value

    override val flow: Flow<List<ManagedTunnel>> = state

    override suspend fun getAll(): List<ManagedTunnel> = state.value

    override suspend fun getByDevice(deviceId: String): List<ManagedTunnel> =
        state.value.filter { it.deviceId == deviceId }

    override suspend fun getByTunnelId(tunnelId: Int): ManagedTunnel? =
        state.value.firstOrNull { it.tunnelId == tunnelId }

    override suspend fun bind(binding: ManagedTunnel) {
        state.value =
            state.value.filterNot {
                it.deviceId == binding.deviceId &&
                    it.interfaceId == binding.interfaceId &&
                    it.peerId == binding.peerId
            } + binding
    }

    override suspend fun unbind(deviceId: String, interfaceId: String, peerId: String) {
        state.value =
            state.value.filterNot {
                it.deviceId == deviceId && it.interfaceId == interfaceId && it.peerId == peerId
            }
    }

    override suspend fun unbindDevice(deviceId: String) {
        state.value = state.value.filterNot { it.deviceId == deviceId }
    }

    override suspend fun unbindByTunnelId(tunnelId: Int) {
        state.value = state.value.filterNot { it.tunnelId == tunnelId }
    }
}

internal class InMemoryTunnelRepository(initial: List<TunnelConfig> = emptyList()) :
    TunnelRepository {
    private val state = MutableStateFlow(initial)
    private var nextId = (initial.maxOfOrNull { it.id } ?: 0) + 1

    var saveCount = 0
        private set

    var deleteCount = 0
        private set

    val tunnels: List<TunnelConfig>
        get() = state.value

    override val flow: Flow<List<TunnelConfig>> = state

    override val userTunnelsFlow: Flow<List<TunnelConfig>> = state.map { tunnels ->
        tunnels.filterNot { it.isGlobalConfig }
    }

    override val globalTunnelFlow: Flow<TunnelConfig?> = state.map { tunnels ->
        tunnels.firstOrNull { it.isGlobalConfig }
    }

    override suspend fun getAll(): List<TunnelConfig> = state.value

    override suspend fun setMetered(tunnelId: Int, value: Boolean) {
        update(tunnelId) { it.copy(isMetered = value) }
    }

    override suspend fun setDDNSTunnel(tunnelId: Int, value: Boolean) {
        update(tunnelId) { it.copy(isDDNSTunnel = value) }
    }

    override suspend fun save(tunnelConfig: TunnelConfig) {
        saveCount++
        state.value =
            if (tunnelConfig.id == 0) {
                state.value + tunnelConfig.copy(id = nextId++)
            } else {
                state.value.map { if (it.id == tunnelConfig.id) tunnelConfig else it }
            }
    }

    override suspend fun saveAll(tunnelConfigList: List<TunnelConfig>) {
        tunnelConfigList.forEach { save(it) }
    }

    override suspend fun updateAll(tunnelConfigList: List<TunnelConfig>) {
        state.value =
            state.value.map { existing ->
                tunnelConfigList.firstOrNull { it.id == existing.id } ?: existing
            }
    }

    override suspend fun updatePrimaryTunnel(tunnelConfig: TunnelConfig?) = Unit

    override suspend fun updateMobileDataTunnel(tunnelConfig: TunnelConfig?) = Unit

    override suspend fun updateEthernetTunnel(tunnelConfig: TunnelConfig?) = Unit

    override suspend fun delete(tunnelConfig: TunnelConfig) {
        deleteCount++
        state.value = state.value.filterNot { it.id == tunnelConfig.id }
    }

    override suspend fun getById(id: Int): TunnelConfig? = state.value.firstOrNull { it.id == id }

    override suspend fun getDefaultTunnel(): TunnelConfig? =
        state.value.firstOrNull { !it.isGlobalConfig }

    override suspend fun count(): Int = state.value.size

    override suspend fun findByTunnelName(name: String): TunnelConfig? =
        state.value.firstOrNull { it.name == name }

    override suspend fun findByTunnelNetworksName(name: String): List<TunnelConfig> =
        state.value.filter { it.tunnelNetworks.contains(name) }

    override suspend fun findByMobileDataTunnel(): List<TunnelConfig> =
        state.value.filter { it.isMobileDataTunnel }

    override suspend fun findPrimary(): List<TunnelConfig> =
        state.value.filter { it.isPrimaryTunnel }

    override suspend fun delete(tunnels: List<TunnelConfig>) {
        tunnels.forEach { delete(it) }
    }

    override suspend fun ensureGlobalConfigExists() {
        if (globalTunnelFlow.first() == null) save(TunnelConfig.generateDefaultGlobalConfig())
    }

    private fun update(tunnelId: Int, transform: (TunnelConfig) -> TunnelConfig) {
        state.value = state.value.map { if (it.id == tunnelId) transform(it) else it }
    }
}

internal class SyncTestEnvironment(
    val account: FakeAccountRepository,
    val settings: FakeAccountSettingsRepository,
    val session: MutableStateFlow<SessionState>,
    val tunnels: InMemoryTunnelRepository,
    val managed: FakeManagedTunnelRepository,
    val service: ManagedTunnelSyncService,
) {
    val createdDeviceNames: List<String>
        get() = account.createdDeviceNames
}

internal fun syncEnvironment(
    snapshot: AccountSnapshot = accountSnapshot(),
    session: SessionState = activeSession,
    serverUrl: String = TEST_SERVER_URL,
    tunnels: List<TunnelConfig> = emptyList(),
    bindings: List<ManagedTunnel> = emptyList(),
    deviceName: String = "Test Device",
    syncTimeoutMillis: Long = 25_000L,
    configure: FakeAccountRepository.() -> Unit = {},
): SyncTestEnvironment {
    val account = FakeAccountRepository(AccountResult.Success(snapshot)).apply(configure)
    val settings = FakeAccountSettingsRepository(serverUrl)
    val sessionState = MutableStateFlow(session)
    val tunnelRepository = InMemoryTunnelRepository(tunnels)
    val managedRepository = FakeManagedTunnelRepository(bindings)
    val service =
        RemoteManagedTunnelSyncService(
            accountRepository = account,
            accountSettingsRepository = settings,
            session = sessionState,
            managedTunnelRepository = managedRepository,
            tunnelRepository = tunnelRepository,
            deviceNameProvider = { deviceName },
            now = { SYNC_TIMESTAMP },
            syncTimeoutMillis = syncTimeoutMillis,
        )
    return SyncTestEnvironment(
        account = account,
        settings = settings,
        session = sessionState,
        tunnels = tunnelRepository,
        managed = managedRepository,
        service = service,
    )
}

internal const val TEST_SERVER_URL = "https://panel.test"

internal const val SYNC_TIMESTAMP = 1_700_000_000_000L
