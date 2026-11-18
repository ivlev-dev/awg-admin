package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountResult
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.repository.AccountRepository

class AccountActions(private val accountRepository: AccountRepository) {
    suspend fun bootstrap(): ActionResult<AccountSnapshot> =
        accountRepository.bootstrap().toResult(AccountActionKind.Generic)

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

    suspend fun deviceEndpoint(id: String): ActionResult<String> =
        when (val result = accountRepository.deviceConfig(id)) {
            is AccountResult.Success -> ActionResult.Success(result.value.endpoint.ifBlank { "" })
            is AccountResult.Failure ->
                ActionResult.Failure(AccountMessages.of(result.error, AccountActionKind.Device))
        }

    private fun <T> AccountResult<T>.toResult(kind: AccountActionKind): ActionResult<T> =
        when (this) {
            is AccountResult.Success -> ActionResult.Success(value)
            is AccountResult.Failure -> ActionResult.Failure(AccountMessages.of(error, kind))
        }
}
