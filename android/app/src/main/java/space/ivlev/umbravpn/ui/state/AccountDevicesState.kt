package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Immutable
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.DeviceQuery
import space.ivlev.umbravpn.domain.model.account.DeviceStatusFilter

enum class DeviceListFooter {
    None,
    Loading,
    Error,
    LoadMore,
    End,
}

@Immutable
data class AccountDevicesState(
    val items: List<AccountDevice> = emptyList(),
    val total: Int = 0,
    val limit: Int = DeviceQuery.DEFAULT_LIMIT,
    val offset: Int = 0,
    val query: String = "",
    val status: DeviceStatusFilter = DeviceStatusFilter.All,
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val error: AccountMessage? = null,
    val isLoaded: Boolean = false,
) {
    val hasMore: Boolean
        get() = isLoaded && items.size < total

    val canLoadMore: Boolean
        get() = hasMore && !isLoading && !isLoadingMore && error == null

    val isEmpty: Boolean
        get() = isLoaded && items.isEmpty()

    val footer: DeviceListFooter
        get() =
            when {
                !isLoaded -> DeviceListFooter.None
                isLoadingMore -> DeviceListFooter.Loading
                error != null -> DeviceListFooter.Error
                hasMore -> DeviceListFooter.LoadMore
                items.isNotEmpty() -> DeviceListFooter.End
                else -> DeviceListFooter.None
            }
}
