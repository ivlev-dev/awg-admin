package space.ivlev.umbravpn.domain.model

import androidx.compose.runtime.Immutable

@Immutable
data class Page<T>(
    val items: List<T>,
    val total: Int,
    val limit: Int,
    val offset: Int,
) {
    val hasMore: Boolean
        get() = offset + items.size < total
}
