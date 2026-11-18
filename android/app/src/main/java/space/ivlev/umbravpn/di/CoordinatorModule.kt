package space.ivlev.umbravpn.di

import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.module
import space.ivlev.umbravpn.core.orchestration.AppBoostrapCoordinator
import space.ivlev.umbravpn.core.orchestration.DnsSettingsCoordinator
import space.ivlev.umbravpn.core.orchestration.FileExportCoordinator
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelSyncStarter
import space.ivlev.umbravpn.core.orchestration.NotificationActionCoordinator
import space.ivlev.umbravpn.core.orchestration.ShortcutCoordinator
import space.ivlev.umbravpn.core.orchestration.StartupCoordinator
import space.ivlev.umbravpn.core.orchestration.TunnelBackendCoordinator
import space.ivlev.umbravpn.core.orchestration.TunnelCoordinator
import space.ivlev.umbravpn.data.account.SessionManager

val coordinatorModule = module {
    singleOf(::FileExportCoordinator)
    singleOf(::ShortcutCoordinator)
    singleOf(::NotificationActionCoordinator)
    singleOf(::TunnelBackendCoordinator)
    singleOf(::StartupCoordinator)
    singleOf(::DnsSettingsCoordinator)
    single {
        TunnelCoordinator(
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(),
            get(named(Scope.APPLICATION)),
        )
    }
    singleOf(::AppBoostrapCoordinator)
    single {
        ManagedTunnelSyncStarter(
            session = get<SessionManager>().state,
            syncService = get(),
            scope = get(named(Scope.APPLICATION)),
            dispatcher = get(named(Dispatcher.IO)),
        )
    }
}
