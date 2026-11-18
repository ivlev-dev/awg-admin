package space.ivlev.umbravpn.data.network

import space.ivlev.umbravpn.data.entity.GitHubRelease

interface GitHubApi {
    suspend fun getLatestRelease(owner: String, repo: String): Result<GitHubRelease>

    suspend fun getNightlyRelease(owner: String, repo: String): Result<GitHubRelease>
}
