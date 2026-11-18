package space.ivlev.umbravpn.data.repository

import space.ivlev.umbravpn.data.account.AccountApi
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.repository.AccountRepository

class KtorAccountRepository(private val api: AccountApi) : AccountRepository {
    override suspend fun bootstrap(): AccountResult<AccountSnapshot> = api.bootstrap()

    override suspend fun createDevice(name: String): AccountResult<CreatedDevice> =
        api.createDevice(name)

    override suspend fun deviceConfig(id: String): AccountResult<DeviceConfig> =
        api.deviceConfig(id)

    override suspend fun renameDevice(id: String, name: String): AccountResult<AccountDevice> =
        api.renameDevice(id, name)

    override suspend fun deleteDevice(id: String): AccountResult<Unit> = api.deleteDevice(id)
}
