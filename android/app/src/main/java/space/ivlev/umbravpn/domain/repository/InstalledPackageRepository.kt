package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.domain.model.InstalledPackage

interface InstalledPackageRepository {
    val installedPackages: StateFlow<List<InstalledPackage>>

    suspend fun getInstalledPackages(): List<InstalledPackage>

    suspend fun refreshInstalledPackages(): List<InstalledPackage>
}
