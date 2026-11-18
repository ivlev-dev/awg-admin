package space.ivlev.umbravpn

import android.app.Application
import android.content.ComponentCallbacks2
import android.os.StrictMode
import androidx.core.os.UserManagerCompat
import androidx.work.Configuration
import com.wgtunnel.backend.Backend
import com.wgtunnel.backend.BackendLog
import com.wgtunnel.backend.LogLevel
import com.wgtunnel.backend.service.AlwaysOnCallback
import com.wgtunnel.backend.service.RuntimeManager
import com.zaneschepke.logcatter.LogReader
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.koin.android.ext.android.get
import org.koin.android.ext.android.inject
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.androidx.workmanager.factory.KoinWorkerFactory
import org.koin.core.annotation.KoinViewModelScopeApi
import org.koin.core.component.KoinComponent
import org.koin.core.context.GlobalContext.startKoin
import org.koin.core.option.viewModelScopeFactory
import org.koin.core.qualifier.named
import space.ivlev.umbravpn.core.event.TunnelEventDispatcher
import space.ivlev.umbravpn.core.orchestration.AppBoostrapCoordinator
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelSyncStarter
import space.ivlev.umbravpn.core.orchestration.StartupCoordinator
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.core.tunnel.AppProvider
import space.ivlev.umbravpn.core.tunnel.TunnelOriginHolder
import space.ivlev.umbravpn.core.tunnel.TunnelProvider
import space.ivlev.umbravpn.core.worker.ManagedTunnelSyncWorker
import space.ivlev.umbravpn.core.worker.UpdateCheckWorker
import space.ivlev.umbravpn.di.Dispatcher
import space.ivlev.umbravpn.di.Scope
import space.ivlev.umbravpn.di.accountModule
import space.ivlev.umbravpn.di.appModule
import space.ivlev.umbravpn.di.coordinatorModule
import space.ivlev.umbravpn.di.databaseModule
import space.ivlev.umbravpn.di.dispatchersModule
import space.ivlev.umbravpn.di.networkModule
import space.ivlev.umbravpn.di.tunnelBackendProviderModule
import space.ivlev.umbravpn.di.workerModule
import space.ivlev.umbravpn.domain.account.AccountAccessCleanup
import space.ivlev.umbravpn.domain.enums.TunnelActionSource
import space.ivlev.umbravpn.domain.events.TunnelActionEvent
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.notification.NotificationService
import space.ivlev.umbravpn.util.Constants
import space.ivlev.umbravpn.util.ReleaseTree
import timber.log.Timber

class UmbraVpnApp : Application(), KoinComponent, Configuration.Provider {

    private val applicationScope: CoroutineScope by inject(named(Scope.APPLICATION))
    private val ioDispatcher: CoroutineDispatcher by inject(named(Dispatcher.IO))

    private val boostrapCoordinator: AppBoostrapCoordinator by inject()

    private val notificationService: NotificationService by inject()

    private val startupCoordinator: StartupCoordinator by inject()

    private val tunnelCoordinator: TunnelCoordinator by inject()

    private val managedTunnelSyncStarter: ManagedTunnelSyncStarter by inject()

    private val managedTunnelAutoConnector: ManagedTunnelAutoConnector by inject()

    private val authRepository: AuthRepository by inject()

    private val accountAccessCleanup: AccountAccessCleanup by inject()

    private val backend: Backend by inject()

    private val alwaysOnCallback =
        object : AlwaysOnCallback {
            override fun alwaysOnTriggered() {
                applicationScope.launch { startupCoordinator.handleAlwaysOnTrigger() }
            }

            override fun onStickyRestart() {
                applicationScope.launch { startupCoordinator.restoreAfterStickyRestart() }
            }

            override fun onVpnRevoked() {
                startupCoordinator.markVpnRevoked()
                applicationScope.launch { startupCoordinator.handleVpnRevoked() }
            }
        }

    @OptIn(KoinViewModelScopeApi::class)
    override fun onCreate() {
        super.onCreate()
        BackendLog.setMinLevel(if (BuildConfig.DEBUG) LogLevel.Debug else LogLevel.Info)
        startKoin {
            androidContext(this@UmbraVpnApp)
            if (BuildConfig.DEBUG) androidLogger()
            modules(
                dispatchersModule,
                appModule,
                databaseModule,
                tunnelBackendProviderModule,
                workerModule,
                coordinatorModule,
                networkModule,
                accountModule,
            )
            options(viewModelScopeFactory())
        }
        instance = this

        notificationService.createAllChannels()

        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build(),
            )
            StrictMode.setVmPolicy(StrictMode.VmPolicy.Builder().detectAll().penaltyLog().build())
        } else {
            Timber.plant(ReleaseTree())
        }

        RuntimeManager.alwaysOnCallback = alwaysOnCallback

        val dispatcher = get<TunnelEventDispatcher>()
        val provider = get<TunnelProvider>()

        // for notifications
        dispatcher.bind(applicationScope, provider.events, tunnelCoordinator.errors)
        get<TunnelOriginHolder>().bind(applicationScope, tunnelCoordinator.actions)
        get<AppProvider>().bind(applicationScope)

        // WorkManager keeps its database in credential encrypted storage, which is locked until the
        // first unlock after boot.
        if (
            BuildConfig.FLAVOR == Constants.STANDALONE_FLAVOR &&
                UserManagerCompat.isUserUnlocked(this)
        ) {
            UpdateCheckWorker.start(this)
        }

        if (UserManagerCompat.isUserUnlocked(this)) {
            ManagedTunnelSyncWorker.start(this)
        }
        managedTunnelSyncStarter.start()

        applicationScope.launch {
            tunnelCoordinator.actions.collect { event ->
                if (event is TunnelActionEvent.Stopped && event.source == TunnelActionSource.USER) {
                    managedTunnelAutoConnector.onManualDisconnect()
                }
            }
        }

        applicationScope.launch(ioDispatcher) {
            authRepository.session.collect { accountAccessCleanup.onSessionState(it) }
        }

        applicationScope.launch(ioDispatcher) {
            if (authRepository.session.value is SessionState.Unknown) {
                authRepository.me()
            }
            managedTunnelAutoConnector.ensureConnected()
        }

        applicationScope.launch(ioDispatcher) { boostrapCoordinator.bootstrap(this@UmbraVpnApp) }
    }

    // WorkManager starts on first use, not with the process, so a process started before the
    // user unlocks after boot never opens its database
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(KoinWorkerFactory()).build()

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // numeric compare also covers the deprecated levels above background on older apis
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
            applicationScope.launch { get<LogReader>().clearBufferedLogs() }
        }
    }

    companion object {
        lateinit var instance: UmbraVpnApp
            private set
    }
}
