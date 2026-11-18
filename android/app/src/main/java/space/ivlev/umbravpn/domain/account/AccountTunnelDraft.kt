package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountInterface

object AccountTunnelDraft {
    const val MAX_LABEL_LENGTH = 64

    fun interfaces(interfaces: List<AccountInterface>): List<AccountInterface> = interfaces.filter {
        it.id.isNotBlank()
    }

    fun initialInterface(interfaces: List<AccountInterface>): AccountInterface? =
        interfaces(interfaces).firstOrNull()

    fun defaultLabel(accountInterface: AccountInterface?): String =
        accountInterface?.name?.trim().orEmpty()

    fun preventEmptyLabel(label: String, fallback: String): String =
        label.trim().ifEmpty { fallback.trim() }

    fun labelError(label: String): AccountMessage? {
        val trimmed = label.trim()
        return when {
            trimmed.isEmpty() -> AccountMessage.EmptyTunnelLabel
            trimmed.length > MAX_LABEL_LENGTH -> AccountMessage.TunnelLabelTooLong
            else -> null
        }
    }

    fun isValid(interfaceId: String?, label: String): Boolean =
        !interfaceId.isNullOrBlank() && labelError(label) == null

    fun payload(interfaceId: String?, label: String): Pair<String, String>? {
        val id = interfaceId?.takeIf { it.isNotBlank() } ?: return null
        if (labelError(label) != null) return null
        return id to label.trim()
    }
}
