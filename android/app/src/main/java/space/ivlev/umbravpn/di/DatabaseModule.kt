package space.ivlev.umbravpn.di

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import org.koin.android.ext.koin.androidContext
import org.koin.core.annotation.KoinExperimentalAPI
import org.koin.core.annotation.KoinViewModelScopeApi
import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import org.koin.dsl.onClose
import org.koin.viewmodel.scope.viewModelScope
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.data.AppDatabase
import space.ivlev.umbravpn.data.DataStoreManager
import space.ivlev.umbravpn.data.DatabaseCallback
import space.ivlev.umbravpn.data.DatabaseMaintenance
import space.ivlev.umbravpn.data.backup.DatabaseBackup
import space.ivlev.umbravpn.data.migrations.MIGRATION_23_24
import space.ivlev.umbravpn.data.migrations.MIGRATION_25_26
import space.ivlev.umbravpn.data.migrations.MIGRATION_28_29
import space.ivlev.umbravpn.data.migrations.MIGRATION_42_43
import space.ivlev.umbravpn.data.migrations.MIGRATION_43_44
import space.ivlev.umbravpn.data.migrations.MIGRATION_44_45
import space.ivlev.umbravpn.data.repository.DataStoreAppStateRepository
import space.ivlev.umbravpn.data.repository.InstalledAndroidPackageRepository
import space.ivlev.umbravpn.data.repository.RoomAutoTunnelSettingsRepository
import space.ivlev.umbravpn.data.repository.RoomDnsSettingsRepository
import space.ivlev.umbravpn.data.repository.RoomLockdownSettingsRepository
import space.ivlev.umbravpn.data.repository.RoomManagedTunnelRepository
import space.ivlev.umbravpn.data.repository.RoomMonitoringSettingsRepository
import space.ivlev.umbravpn.data.repository.RoomProxySettingsRepository
import space.ivlev.umbravpn.data.repository.RoomSettingsRepository
import space.ivlev.umbravpn.data.repository.RoomTunnelGroupRepository
import space.ivlev.umbravpn.data.repository.RoomTunnelRepository
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.AutoTunnelSettingsRepository
import space.ivlev.umbravpn.domain.repository.DnsSettingsRepository
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.domain.repository.InstalledPackageRepository
import space.ivlev.umbravpn.domain.repository.LockdownSettingsRepository
import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.MonitoringSettingsRepository
import space.ivlev.umbravpn.domain.repository.ProxySettingsRepository
import space.ivlev.umbravpn.domain.repository.TunnelGroupRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository

@OptIn(KoinExperimentalAPI::class, KoinViewModelScopeApi::class)
val databaseModule = module {
    single<RoomDatabase.Callback> { DatabaseCallback(lazy { get() }) }

    single {
        Room.databaseBuilder(
                androidContext(),
                AppDatabase::class.java,
                get<Context>().getString(R.string.db_name),
            )
            .addMigrations(
                MIGRATION_23_24(get<DataStoreManager>().dataStore),
                MIGRATION_25_26,
                MIGRATION_28_29,
                MIGRATION_42_43,
                MIGRATION_43_44,
                MIGRATION_44_45,
            )
            // Destructive migration is intentionally kept: the schema has explicit migrations for
            // every historical version, so this only triggers for a database written by a newer,
            // unsupported build. Losing local tunnel configs is preferable to crashing at startup;
            // user data can be restored from an encrypted backup.
            .fallbackToDestructiveMigration(true)
            .addCallback(get())
            .build()
    }

    single { get<AppDatabase>().generalSettingsDao() }
    single { get<AppDatabase>().lockdownSettingsDao() }
    single { get<AppDatabase>().dnsSettingsDao() }
    single { get<AppDatabase>().autoTunnelSettingsDao() }
    single { get<AppDatabase>().monitoringSettingsDao() }
    single { get<AppDatabase>().proxySettingsDoa() }
    single { get<AppDatabase>().tunnelConfigDoa() }
    single { get<AppDatabase>().tunnelGroupDao() }
    single { get<AppDatabase>().managedTunnelDao() }

    single { DataStoreManager(androidContext(), get(named(Dispatcher.IO))) }

    single { DatabaseMaintenance(get(), get(named(Dispatcher.IO))) }

    single<AppStateRepository> {
        DataStoreAppStateRepository(get(), get(named(Scope.APPLICATION)), get(named(Dispatcher.IO)))
    }
    singleOf(::RoomAutoTunnelSettingsRepository) bind AutoTunnelSettingsRepository::class
    singleOf(::RoomDnsSettingsRepository) bind DnsSettingsRepository::class
    singleOf(::RoomLockdownSettingsRepository) bind LockdownSettingsRepository::class
    singleOf(::RoomMonitoringSettingsRepository) bind MonitoringSettingsRepository::class
    singleOf(::RoomProxySettingsRepository) bind ProxySettingsRepository::class
    singleOf(::RoomSettingsRepository) bind GeneralSettingRepository::class
    singleOf(::RoomTunnelRepository) bind TunnelRepository::class
    singleOf(::RoomTunnelGroupRepository) bind TunnelGroupRepository::class
    singleOf(::RoomManagedTunnelRepository) bind ManagedTunnelRepository::class
    single {
        DatabaseBackup(
            androidContext(),
            get(),
            get(),
            get(),
            get(),
            get(named(Dispatcher.IO)),
        )
    }
    viewModelScope {
        scoped<InstalledPackageRepository> {
            InstalledAndroidPackageRepository(androidContext(), get(named(Dispatcher.IO)))
        } onClose { (it as? AutoCloseable)?.close() }
    }
}
