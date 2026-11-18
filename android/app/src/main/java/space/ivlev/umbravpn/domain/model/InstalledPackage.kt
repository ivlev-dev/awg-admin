package space.ivlev.umbravpn.domain.model

data class InstalledPackage(
    val name: String,
    val packageName: String,
    val uId: Int,
    val isSystem: Boolean = false,
)
