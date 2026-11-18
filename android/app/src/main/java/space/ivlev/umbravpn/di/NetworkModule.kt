package space.ivlev.umbravpn.di

import android.os.StrictMode
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.data.network.GitHubApi
import space.ivlev.umbravpn.data.network.KtorClient
import space.ivlev.umbravpn.data.network.KtorGitHubApi
import space.ivlev.umbravpn.data.network.StreamingFileDownloader
import space.ivlev.umbravpn.data.repository.DownloadManagerUpdateDownloader
import space.ivlev.umbravpn.data.repository.GitHubUpdateRepository
import space.ivlev.umbravpn.domain.repository.UpdateDownloader
import space.ivlev.umbravpn.domain.repository.UpdateRepository

val networkModule = module {
    single {
        val client =
            if (BuildConfig.DEBUG) {
                val oldPolicy = StrictMode.allowThreadDiskReads()
                try {
                    KtorClient.create()
                } finally {
                    StrictMode.setThreadPolicy(oldPolicy)
                }
            } else {
                KtorClient.create()
            }
        client
    }
    singleOf(::KtorGitHubApi) bind GitHubApi::class

    single<UpdateRepository> { GitHubUpdateRepository(get(), "", "", get(named(Dispatcher.IO))) }

    single<UpdateDownloader> {
        DownloadManagerUpdateDownloader(
            androidContext(),
            get(named(Scope.APPLICATION)),
            get(named(Dispatcher.IO)),
            get(),
            get(),
            get(),
            StreamingFileDownloader(get()),
        )
    }
}
