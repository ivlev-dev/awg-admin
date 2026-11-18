package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.Asset
import space.ivlev.umbravpn.data.entity.GitHubRelease
import space.ivlev.umbravpn.domain.model.AppUpdate

object GitHubReleaseMapper {
    fun toAppUpdate(
        gitHubRelease: GitHubRelease,
        apkAsset: Asset,
        newVersion: String,
    ): AppUpdate =
        AppUpdate(
            version = newVersion,
            releaseUrl = gitHubRelease.htmlUrl,
            apkUrl = apkAsset.browserDownloadUrl,
            apkFileName = apkAsset.name,
            apkSize = apkAsset.size.takeIf { it > 0 },
        )
}
