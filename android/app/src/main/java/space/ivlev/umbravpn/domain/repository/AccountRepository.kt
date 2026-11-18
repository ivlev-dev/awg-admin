package space.ivlev.umbravpn.domain.repository

import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig

interface AccountRepository {
    suspend fun bootstrap(): AccountResult<AccountSnapshot>

    suspend fun createDevice(
        name: String,
        interfaceIds: List<String> = emptyList(),
        idempotencyKey: String? = null,
    ): AccountResult<CreatedDevice>

    suspend fun deviceConfig(id: String): AccountResult<DeviceConfig>

    suspend fun deviceConfigs(id: String): AccountResult<List<DeviceConfig>>

    suspend fun addDeviceTunnel(
        deviceId: String,
        interfaceId: String,
        label: String? = null,
        idempotencyKey: String? = null,
    ): AccountResult<CreatedDevice>

    suspend fun removeDeviceTunnel(deviceId: String, peerId: String): AccountResult<Unit>

    suspend fun renameDeviceTunnel(
        deviceId: String,
        peerId: String,
        label: String,
    ): AccountResult<AccountDevice>

    suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice>

    suspend fun deleteDevice(id: String): AccountResult<Unit>
}
