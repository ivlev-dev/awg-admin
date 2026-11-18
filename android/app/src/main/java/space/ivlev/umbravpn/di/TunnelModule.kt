package space.ivlev.umbravpn.di

import com.wgtunnel.backend.ApplicationProvider
import com.wgtunnel.backend.Backend
import com.wgtunnel.backend.TunnelBackend
import com.wgtunnel.backend.exception.ShellException
import com.wgtunnel.backend.shell.ShellExecutor
import com.wgtunnel.backend.system.NetworkSnapshot
import com.zaneschepke.networkmonitor.AndroidNetworkMonitor
import com.zaneschepke.networkmonitor.NetworkMonitor
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import space.ivlev.umbravpn.core.event.TunnelEventDispatcher
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.tunnel.AppProvider
import space.ivlev.umbravpn.core.tunnel.StrictSplitDefaults
import space.ivlev.umbravpn.core.tunnel.TunnelBackendProvider
import space.ivlev.umbravpn.core.tunnel.TunnelOriginHolder
import space.ivlev.umbravpn.core.tunnel.TunnelProvider
import space.ivlev.umbravpn.lifecyle.AppVisibilityObserver
import space.ivlev.umbravpn.notification.AndroidTunnelNotificationService
import space.ivlev.umbravpn.notification.TunnelNotificationService
import timber.log.Timber

val tunnelBackendProviderModule = module {
    single<TunnelNotificationService> { AndroidTunnelNotificationService(get()) }
    single { AppVisibilityObserver() }
    // Eager, so it sees the app go to the background and starts on the main thread
    single(createdAtStart = true) { AppLockManager(get(), get(), get(named(Scope.APPLICATION))) }
    singleOf(::TunnelEventDispatcher)

    singleOf(::TunnelOriginHolder)
    singleOf(::StrictSplitDefaults)

    single {
        AppProvider(
            notificationService = get(),
            tunnelNotificationService = get(),
            tunnelRepository = get(),
            settingsRepository = get(),
            tunnelOriginHolder = get(),
        )
    } bind ApplicationProvider::class

    single<NetworkMonitor> {
        AndroidNetworkMonitor(
            androidContext(),
            object : AndroidNetworkMonitor.ConfigurationListener {
                override suspend fun runRootShellCommand(cmd: String): String? {
                    return try {
                        withTimeout(3_000.milliseconds) {
                            withContext(Dispatchers.IO) {
                                val result = ShellExecutor().run(cmd)
                                result.output
                            }
                        }
                    } catch (e: ShellException) {
                        Timber.e(e)
                        null
                    }
                }

                override val detectionMethod: Flow<AndroidNetworkMonitor.WifiDetectionMethod> =
                    flowOf(AndroidNetworkMonitor.WifiDetectionMethod.DEFAULT)
            },
            get<CoroutineScope>(named(Scope.APPLICATION)),
        )
    }

    single<Backend> {
        val scope = get<CoroutineScope>(named(Scope.APPLICATION))
        val androidMonitor = get<com.zaneschepke.networkmonitor.NetworkMonitor>()

        val mappedNetworkState: StateFlow<NetworkSnapshot?> =
            androidMonitor.connectivityStateFlow
                .filterNotNull()
                .map { state ->
                    NetworkSnapshot(
                        key = state.activeNetwork.key(),
                        hasIpv6 = state.hasIpv6,
                        isUsable = state.hasUsableNetwork(),
                        network = state.activeNetwork.network,
                    )
                }
                .stateIn(scope = scope, started = SharingStarted.Eagerly, initialValue = null)

        val networkMonitor =
            object : com.wgtunnel.backend.system.NetworkMonitor {
                override val networkState: StateFlow<NetworkSnapshot?> = mappedNetworkState
            }
        TunnelBackend(scope, get(), networkMonitor)
    }

    single<TunnelProvider> {
        TunnelBackendProvider(
            get<Backend>(),
            get(named(Scope.APPLICATION)),
            get(named(Dispatcher.IO)),
        )
    }
}
