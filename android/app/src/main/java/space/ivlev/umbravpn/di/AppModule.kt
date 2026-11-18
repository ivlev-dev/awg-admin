package space.ivlev.umbravpn.di

import android.content.Context
import android.os.PowerManager
import android.os.StrictMode
import com.zaneschepke.logcatter.LogReader
import com.zaneschepke.logcatter.LogcatReader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.koin.android.ext.koin.androidContext
import org.koin.core.annotation.KoinExperimentalAPI
import org.koin.core.module.dsl.singleOf
import org.koin.core.module.dsl.viewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import space.ivlev.umbravpn.BuildConfig
import space.ivlev.umbravpn.core.lock.EncryptedPinAttemptStore
import space.ivlev.umbravpn.core.lock.PinLockGuard
import space.ivlev.umbravpn.core.shortcut.DynamicShortcutManager
import space.ivlev.umbravpn.core.shortcut.ShortcutManager
import space.ivlev.umbravpn.domain.repository.GlobalEffectRepository
import space.ivlev.umbravpn.domain.repository.SelectedTunnelsRepository
import space.ivlev.umbravpn.notification.AndroidNotificationService
import space.ivlev.umbravpn.notification.NotificationService
import space.ivlev.umbravpn.service.ServiceManager
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.logging.NoopLogReader
import space.ivlev.umbravpn.util.network.NetworkUtils
import space.ivlev.umbravpn.viewmodel.AccountViewModel
import space.ivlev.umbravpn.viewmodel.DnsViewModel
import space.ivlev.umbravpn.viewmodel.EmailVerificationViewModel
import space.ivlev.umbravpn.viewmodel.ForgotPasswordViewModel
import space.ivlev.umbravpn.viewmodel.GlobalAmneziaViewModel
import space.ivlev.umbravpn.viewmodel.LockdownViewModel
import space.ivlev.umbravpn.viewmodel.LoggerViewModel
import space.ivlev.umbravpn.viewmodel.LoginViewModel
import space.ivlev.umbravpn.viewmodel.MonitoringViewModel
import space.ivlev.umbravpn.viewmodel.OnboardingViewModel
import space.ivlev.umbravpn.viewmodel.ProxySettingsViewModel
import space.ivlev.umbravpn.viewmodel.RegisterViewModel
import space.ivlev.umbravpn.viewmodel.ResetPasswordViewModel
import space.ivlev.umbravpn.viewmodel.SettingsViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel
import space.ivlev.umbravpn.viewmodel.SplitTunnelViewModel
import space.ivlev.umbravpn.viewmodel.SupportViewModel
import space.ivlev.umbravpn.viewmodel.TunnelViewModel

@OptIn(KoinExperimentalAPI::class)
val appModule = module {
    single<CoroutineScope>(named(Scope.APPLICATION)) {
        CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
    single<LogReader> {
        if (!BuildConfig.DEBUG) {
            NoopLogReader()
        } else {
            val version = BuildConfig.VERSION_NAME
            val flavor = BuildConfig.FLAVOR
            val readPolicy = StrictMode.allowThreadDiskReads()
            val writePolicy = StrictMode.allowThreadDiskWrites()
            try {
                val storageDir = androidContext().filesDir.absolutePath
                LogcatReader.init(storageDir = storageDir, appVersion = version, appFlavor = flavor)
            } finally {
                StrictMode.setThreadPolicy(readPolicy)
                StrictMode.setThreadPolicy(writePolicy)
            }
        }
    }

    single<PowerManager> {
        androidContext().getSystemService(Context.POWER_SERVICE) as PowerManager
    }
    singleOf(::AndroidNotificationService) bind NotificationService::class
    single { ServiceManager(androidContext()) }

    singleOf(::GlobalEffectRepository)
    single { PinLockGuard(EncryptedPinAttemptStore(androidContext())) }

    single { FileUtils(androidContext(), get(named(Dispatcher.IO))) }
    single<ShortcutManager> { DynamicShortcutManager(androidContext(), get(named(Dispatcher.IO))) }
    singleOf(::SelectedTunnelsRepository)

    single { NetworkUtils(get(named(Dispatcher.IO))) }

    viewModelOf(::AccountViewModel)
    viewModelOf(::DnsViewModel)
    viewModelOf(::EmailVerificationViewModel)
    viewModelOf(::ForgotPasswordViewModel)
    viewModelOf(::GlobalAmneziaViewModel)
    viewModelOf(::LockdownViewModel)
    viewModelOf(::LoginViewModel)
    viewModelOf(::LoggerViewModel)
    viewModelOf(::MonitoringViewModel)
    viewModelOf(::OnboardingViewModel)
    viewModelOf(::ProxySettingsViewModel)
    viewModelOf(::RegisterViewModel)
    viewModelOf(::ResetPasswordViewModel)
    viewModelOf(::SettingsViewModel)
    viewModelOf(::SharedAppViewModel)
    viewModel { (id: Int) -> SplitTunnelViewModel(get(), get(), get(), get(), get(), id) }
    viewModel { SupportViewModel(get(), get(), get()) }
    viewModel { (id: Int) -> TunnelViewModel(get(), get(), get(), id) }
}
