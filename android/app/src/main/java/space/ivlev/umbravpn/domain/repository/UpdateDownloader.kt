package space.ivlev.umbravpn.domain.repository

import kotlinx.coroutines.flow.StateFlow
import space.ivlev.umbravpn.domain.model.AppUpdate
import space.ivlev.umbravpn.domain.model.UpdateDownloadState

interface UpdateDownloader {
    val state: StateFlow<UpdateDownloadState>

    fun activeUpdate(): AppUpdate?

    suspend fun start(update: AppUpdate): Result<Unit>

    suspend fun cancel()

    suspend fun onDownloadComplete(downloadId: Long)
}
