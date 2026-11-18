package space.ivlev.umbravpn.domain.repository

import space.ivlev.umbravpn.domain.model.AppUpdate

interface UpdateRepository {
    suspend fun checkForUpdate(currentVersion: String): Result<AppUpdate?>
}
