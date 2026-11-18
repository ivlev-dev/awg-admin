package space.ivlev.umbravpn.domain.account

import space.ivlev.umbravpn.domain.model.account.AccountInterface

object AccountInterfaceSelection {

    fun isSelectable(interfaces: List<AccountInterface>): Boolean = interfaces.size > 1

    fun initialSelection(interfaces: List<AccountInterface>): Set<String> =
        if (isSelectable(interfaces)) interfaces.mapTo(linkedSetOf()) { it.id } else emptySet()

    fun toggle(selected: Set<String>, interfaceId: String): Set<String> =
        if (interfaceId in selected) selected - interfaceId else selected + interfaceId

    fun payload(interfaces: List<AccountInterface>, selected: Set<String>): List<String> =
        if (isSelectable(interfaces)) interfaces.map { it.id }.filter { it in selected }
        else emptyList()

    fun isValid(interfaces: List<AccountInterface>, selected: Set<String>): Boolean =
        !isSelectable(interfaces) || selected.isNotEmpty()
}
