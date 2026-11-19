package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.Page
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.repository.AccountRepository

class AccountActions(private val accountRepository: AccountRepository) {
    suspend fun bootstrap(): ActionResult<AccountSnapshot> =
        accountRepository.bootstrap().toResult(AccountActionKind.Generic)

    suspend fun pageDevices(query: DeviceQuery): ActionResult<Page<AccountDevice>> =
        accountRepository
            .pageDevices(query.limit, query.offset, query.query, query.status)
            .toResult(AccountActionKind.Device)

    suspend fun createDevice(
        name: String,
        interfaceIds: List<String> = emptyList(),
        idempotencyKey: String? = null,
    ): ActionResult<CreatedDevice> {
        val error = AccountValidation.deviceNameError(name)
        if (error != null) return ActionResult.Failure(error)

        return accountRepository
            .createDevice(name.trim(), interfaceIds.distinct(), idempotencyKey)
            .toResult(AccountActionKind.Device)
    }

    suspend fun renameDevice(id: String, name: String): ActionResult<AccountDevice> {
        val error = AccountValidation.deviceNameError(name)
        if (error != null) return ActionResult.Failure(error)

        return accountRepository.renameDevice(id, name.trim()).toResult(AccountActionKind.Device)
    }

    suspend fun deleteDevice(id: String): ActionResult<Unit> =
        accountRepository.deleteDevice(id).toResult(AccountActionKind.Device)

    suspend fun addDeviceTunnel(
        deviceId: String,
        interfaceId: String,
        label: String? = null,
        idempotencyKey: String? = null,
    ): ActionResult<CreatedDevice> {
        if (deviceId.isBlank()) return ActionResult.Failure(AccountMessage.NotFound)
        if (interfaceId.isBlank()) return ActionResult.Failure(AccountMessage.EmptyInterface)

        return accountRepository
            .addDeviceTunnel(
                deviceId = deviceId,
                interfaceId = interfaceId,
                label = label?.trim()?.takeIf { it.isNotEmpty() },
                idempotencyKey = idempotencyKey,
            )
            .toResult(AccountActionKind.Tunnel)
    }

    suspend fun removeDeviceTunnel(
        deviceId: String,
        peerId: String,
    ): ActionResult<Unit> {
        if (deviceId.isBlank() || peerId.isBlank()) {
            return ActionResult.Failure(AccountMessage.NotFound)
        }

        return accountRepository
            .removeDeviceTunnel(deviceId, peerId)
            .toResult(AccountActionKind.Tunnel)
    }

    suspend fun renameDeviceTunnel(
        deviceId: String,
        peerId: String,
        label: String,
    ): ActionResult<AccountDevice> {
        if (deviceId.isBlank() || peerId.isBlank()) {
            return ActionResult.Failure(AccountMessage.NotFound)
        }
        val error = AccountTunnelDraft.labelError(label)
        if (error != null) return ActionResult.Failure(error)

        return accountRepository
            .renameDeviceTunnel(deviceId, peerId, label.trim())
            .toResult(AccountActionKind.Tunnel)
    }

    suspend fun deviceEndpoint(id: String): ActionResult<String> =
        when (val result = accountRepository.deviceConfig(id)) {
            is AccountResult.Success -> ActionResult.Success(result.value.endpoint.ifBlank { "" })
            is AccountResult.Failure ->
                ActionResult.Failure(AccountMessages.of(result.error, AccountActionKind.Device))
        }

    suspend fun updateFullName(fullName: String): ActionResult<AuthUser> {
        AccountValidation.profileFullNameError(fullName)?.let {
            return ActionResult.Failure(it)
        }

        return accountRepository.updateFullName(fullName.trim()).toResult(AccountActionKind.Generic)
    }

    private fun <T> AccountResult<T>.toResult(kind: AccountActionKind): ActionResult<T> =
        when (this) {
            is AccountResult.Success -> ActionResult.Success(value)
            is AccountResult.Failure -> ActionResult.Failure(AccountMessages.of(error, kind))
        }
}
