package space.ivlev.umbravpn.di

import org.koin.android.ext.koin.androidContext
import org.koin.core.qualifier.named
import org.koin.dsl.module
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.data.account.AccountApi
import space.ivlev.umbravpn.data.account.SessionManager
import space.ivlev.umbravpn.data.network.AccountHttpClientFactory
import space.ivlev.umbravpn.data.network.ServerProbe
import space.ivlev.umbravpn.data.repository.DataStoreAccountSettingsRepository
import space.ivlev.umbravpn.data.repository.KtorAccountRepository
import space.ivlev.umbravpn.data.repository.KtorAuthRepository
import space.ivlev.umbravpn.data.security.EncryptedTokenStore
import space.ivlev.umbravpn.data.sync.RemoteManagedTunnelSyncService
import space.ivlev.umbravpn.data.sync.defaultManagedDeviceName
import space.ivlev.umbravpn.domain.account.AccountAccessCleanup
import space.ivlev.umbravpn.domain.account.AccountActions
import space.ivlev.umbravpn.domain.account.AuthActions
import space.ivlev.umbravpn.domain.account.PendingSignupCache
import space.ivlev.umbravpn.domain.repository.AccountRepository
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.security.TokenStore
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleaner
import space.ivlev.umbravpn.domain.sync.ManagedTunnelCleanup
import space.ivlev.umbravpn.domain.sync.ManagedTunnelSyncService
import space.ivlev.umbravpn.notification.AndroidNotificationService.NotificationChannels
import space.ivlev.umbravpn.notification.ManagedTunnelSyncNotifier
import space.ivlev.umbravpn.notification.NotificationService
import space.ivlev.umbravpn.util.permission.NotificationPermissionHelper

val accountModule = module {
    single<AccountSettingsRepository> { DataStoreAccountSettingsRepository(get()) }
    single<TokenStore> { EncryptedTokenStore(androidContext()) }
    single { SessionManager(get()) }

    single(named(ACCOUNT_HTTP_CLIENT)) { AccountHttpClientFactory.create() }
    single {
        AccountApi(
            client = get(named(ACCOUNT_HTTP_CLIENT)),
            json = AccountHttpClientFactory.json,
            sessionManager = get(),
            settings = get(),
        )
    }

    single<AuthRepository> { KtorAuthRepository(get(), get()) }
    single<AccountRepository> { KtorAccountRepository(get()) }
    single { PendingSignupCache() }
    single { AuthActions(get(), get(), get<SessionManager>()::markBlocked) }
    single { AccountActions(get()) }
    single { ServerProbe(get(named(ACCOUNT_HTTP_CLIENT))) }
    single<ManagedTunnelCleanup> { ManagedTunnelCleaner(get(), get()) }
    single {
        val settings = get<AccountSettingsRepository>()
        AccountAccessCleanup(
            tunnelCleanup = get(),
            resetAutoConnect = get<ManagedTunnelAutoConnector>()::reset,
            settingsRepository = settings,
        )
    }
    single<ManagedTunnelSyncService> {
        RemoteManagedTunnelSyncService(
            accountRepository = get(),
            accountSettingsRepository = get(),
            session = get<SessionManager>().state,
            managedTunnelRepository = get(),
            tunnelRepository = get(),
            deviceNameProvider = { defaultManagedDeviceName() },
        )
    }
    single {
        val notificationService = get<NotificationService>()
        val context = androidContext()
        ManagedTunnelSyncNotifier(
            events = get<ManagedTunnelSyncService>().events,
            scope = get(named(Scope.APPLICATION)),
            isNotificationAllowed = { NotificationPermissionHelper.isPermissionGranted(context) },
            string = { id, args -> context.getString(id, *args) },
            show = { title, text ->
                notificationService.show(
                    NotificationService.SYNC_NOTIFICATION_ID,
                    notificationService.createNotification(
                        channel = NotificationChannels.Sync,
                        title = title,
                        description = text,
                    ),
                )
            },
        )
    }
}

private const val ACCOUNT_HTTP_CLIENT = "account_http_client"
