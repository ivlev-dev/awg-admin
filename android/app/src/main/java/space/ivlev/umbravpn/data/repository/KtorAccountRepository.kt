package space.ivlev.umbravpn.data.repository

import space.ivlev.umbravpn.data.account.AccountApi
import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter
import space.ivlev.umbravpn.domain.repository.AccountRepository

class KtorAccountRepository(private val api: AccountApi) : AccountRepository {
    override suspend fun bootstrap(): AccountResult<AccountSnapshot> = api.bootstrap()

    override suspend fun pageDevices(
        limit: Int,
        offset: Int,
        query: String,
        status: DeviceStatusFilter,
    ): AccountResult<Page<AccountDevice>> = api.pageDevices(limit, offset, query, status)

    override suspend fun createDevice(
        name: String,
        interfaceIds: List<String>,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> = api.createDevice(name, interfaceIds, idempotencyKey)

    override suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> =
        api.deviceConfig(id)

    override suspend fun deviceConfigs(id: String): AccountResult<List<DeviceConfig>> =
        api.deviceConfigs(id)

    override suspend fun addDeviceTunnel(
        deviceId: String,
        interfaceId: String,
        label: String?,
        idempotencyKey: String?,
    ): AccountResult<CreatedDevice> =
        api.addDeviceTunnel(deviceId, interfaceId, label, idempotencyKey)

    override suspend fun removeDeviceTunnel(
        deviceId: String,
        peerId: String,
    ): AccountResult<Unit> = api.removeDeviceTunnel(deviceId, peerId)

    override suspend fun renameDeviceTunnel(
        deviceId: String,
        peerId: String,
        label: String,
    ): AccountResult<AccountDevice> = api.renameDeviceTunnel(deviceId, peerId, label)

    override suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> =
        api.renameDevice(id, name)

    override suspend fun deleteDevice(id: String): AccountResult<Unit> = api.deleteDevice(id)
}
