package space.ivlev.umbravpn.data.repository

import android.os.Build
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.data.mapper.GitHubReleaseMapper
import space.ivlev.umbravpn.data.network.GitHubApi
import space.ivlev.umbravpn.domain.model.AppUpdate
import space.ivlev.umbravpn.domain.repository.UpdateRepository
import space.ivlev.umbravpn.util.Constants
import space.ivlev.umbravpn.util.NumberUtils
import timber.log.Timber

class GitHubUpdateRepository(
    private val gitHubApi: GitHubApi,
    private val githubOwner: String,
    private val githubRepo: String,
    private val ioDispatcher: CoroutineDispatcher,
) : UpdateRepository {

    override suspend fun checkForUpdate(currentVersion: String): Result<AppUpdate?> =
        withContext(ioDispatcher) {
            if (githubOwner.isBlank() || githubRepo.isBlank()) {
                Timber.i("Update checks are disabled for this build")
                return@withContext Result.success(null)
            }
            Timber.i("Checking for update (current=$currentVersion)")
            val isNightly = BuildConfig.VERSION_NAME.contains("nightly", ignoreCase = true)
            val release =
                if (isNightly) {
                    gitHubApi.getNightlyRelease(githubOwner, githubRepo).onFailure(Timber::e)
                } else {
                    gitHubApi.getLatestRelease(githubOwner, githubRepo).onFailure(Timber::e)
                }
            release.map { release ->
                val choice =
                    ApkAssetSelector.select(
                        release.assets,
                        Constants.STANDALONE_FLAVOR,
                        Build.SUPPORTED_ABIS.toList(),
                    ) ?: return@map null
                val newVersion = choice.version

                Timber.i(
                    "Latest version: $newVersion (${choice.asset.name}), current version: $currentVersion",
                )
                val updateAvailable =
                    if (isNightly) {
                        newVersion != currentVersion
                    } else {
                        NumberUtils.compareVersions(newVersion, currentVersion) > 0
                    }

                if (updateAvailable) {
                    GitHubReleaseMapper.toAppUpdate(release, choice.asset, newVersion)
                } else {
                    null
                }
            }
        }
}
