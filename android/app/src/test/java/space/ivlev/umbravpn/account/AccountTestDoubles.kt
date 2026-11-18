package space.ivlev.umbravpn.account

import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountError
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AccountTariff
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository

internal fun testUser(
    email: String = "alice@example.com",
    status: UserStatus = UserStatus.Active,
): AuthUser =
    AuthUser(
        id = "user-1",
        login = "alice",
        email = email,
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
    val registered = mutableListOf<Pair<String, String>>()
    val resentEmails = mutableListOf<String>()
    val forgotEmails = mutableListOf<String>()
    var resetCalls = 0
    var meCalls = 0
    var logoutCalls = 0

    override suspend fun login(
        login: String,
        password: String,
        totpCode: String?,
    ): AccountResult<AuthUser> {
        logins += Triple(login, password, totpCode)
        return loginResult
    }

    override suspend fun register(email: String, password: String): AccountResult<Unit> {
        registered += email to password
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
    val renamed = mutableListOf<Pair<String, String>>()
    val deleted = mutableListOf<String>()
    var bootstrapCalls = 0

    override suspend fun bootstrap(): AccountResult<AccountSnapshot> {
        bootstrapCalls++
        return bootstrapResult
    }

    override suspend fun createDevice(name: String): AccountResult<CreatedDevice> {
        createdNames += name
        return createResult
    }

    override suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> = configResult

    override suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> {
        renamed += id to name
        return renameResult
    }

    override suspend fun deleteDevice(id: String): AccountResult<Unit> {
        deleted += id
        return deleteResult
    }
}
