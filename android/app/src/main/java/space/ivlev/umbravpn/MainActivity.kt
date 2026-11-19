package space.ivlev.umbravpn

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.app.ActivityCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import androidx.lifecycle.lifecycleScope
import androidx.navigation3.runtime.rememberNavBackStack
import com.dokar.sonner.Toast
import com.dokar.sonner.ToastType
import com.dokar.sonner.rememberToasterState
import kotlin.system.exitProcess
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject
import org.koin.androidx.viewmodel.ext.android.viewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.core.lock.AppLockManager
import space.ivlev.umbravpn.core.orchestration.AutoConnectEvent
import space.ivlev.umbravpn.core.orchestration.FileExportCoordinator
import space.ivlev.umbravpn.core.orchestration.ManagedTunnelAutoConnector
import space.ivlev.umbravpn.data.backup.BackupWriteResult
import space.ivlev.umbravpn.data.backup.DatabaseBackup
import space.ivlev.umbravpn.data.backup.RestoreResult
import space.ivlev.umbravpn.domain.account.LogoutCoordinator
import space.ivlev.umbravpn.domain.enums.StrictSplitNotice
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.TunnelConfig
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.repository.AccountSettingsRepository
import space.ivlev.umbravpn.domain.repository.AppStateRepository
import space.ivlev.umbravpn.domain.repository.AuthRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository
import space.ivlev.umbravpn.domain.sideeffect.GlobalSideEffect
import space.ivlev.umbravpn.domain.sideeffect.NotificationPendingAction
import space.ivlev.umbravpn.notification.NotificationService
import space.ivlev.umbravpn.notification.NotificationService.Companion.EXTRA_AUTO_UPDATE
import space.ivlev.umbravpn.notification.NotificationService.Companion.EXTRA_OPEN_SUPPORT
import space.ivlev.umbravpn.notification.NotificationService.Companion.EXTRA_SHOW_UPDATE
import space.ivlev.umbravpn.notification.NotificationService.Companion.UPDATE_AVAILABLE_NOTIFICATION_ID
import space.ivlev.umbravpn.service.tile.TunnelTileRefresher
import space.ivlev.umbravpn.ui.LocalIsAndroidTV
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.AppToaster
import space.ivlev.umbravpn.ui.common.banner.AppAlertBanner
import space.ivlev.umbravpn.ui.common.dialog.LocalNetworkPermissionDialog
import space.ivlev.umbravpn.ui.common.dialog.VpnDeniedDialog
import space.ivlev.umbravpn.ui.common.sheet.StrictSplitNoticeSheet
import space.ivlev.umbravpn.ui.navigation.AppNavDisplay
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.navigation.SecureRoute
import space.ivlev.umbravpn.ui.navigation.Tab
import space.ivlev.umbravpn.ui.navigation.components.BottomNavbar
import space.ivlev.umbravpn.ui.navigation.components.DynamicTopAppBar
import space.ivlev.umbravpn.ui.navigation.components.currentRouteAsNavbarState
import space.ivlev.umbravpn.ui.navigation.functions.rememberNavController
import space.ivlev.umbravpn.ui.navigation.resolveStartRedirect
import space.ivlev.umbravpn.ui.screens.pin.LocalAppLocked
import space.ivlev.umbravpn.ui.screens.pin.PinLockOverlay
import space.ivlev.umbravpn.ui.theme.AlertRed
import space.ivlev.umbravpn.ui.theme.OffWhite
import space.ivlev.umbravpn.ui.theme.UmbraVpnTheme
import space.ivlev.umbravpn.util.FileUtils
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.util.extensions.installApk
import space.ivlev.umbravpn.util.extensions.isRunningOnTv
import space.ivlev.umbravpn.util.extensions.openWebUrl
import space.ivlev.umbravpn.util.permission.LocalNetworkPermissionHelper
import space.ivlev.umbravpn.viewmodel.EmailVerificationViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

class MainActivity : AppCompatActivity() {

    private val appStateRepository: AppStateRepository by inject()
    private val tunnelRepository: TunnelRepository by inject()
    private val fileExportCoordinator: FileExportCoordinator by inject()
    private val notificationService: NotificationService by inject()
    private val databaseBackup: DatabaseBackup by inject()
    private val appLockManager: AppLockManager by inject()
    private val accountSettingsRepository: AccountSettingsRepository by inject()
    private val authRepository: AuthRepository by inject()
    private val logoutCoordinator: LogoutCoordinator by inject()
    private val autoConnector: ManagedTunnelAutoConnector by inject()

    val viewModel by viewModel<SharedAppViewModel>()
    val verificationViewModel by viewModel<EmailVerificationViewModel>()
    private var pendingBackupPassword: String? = null
    private var pendingVerifyDeepLink = false

    private val createBackupLauncher =
        registerForActivityResult(
            ActivityResultContracts.CreateDocument(FileUtils.ZIP_FILE_MIME_TYPE),
        ) { uri ->
            val password = pendingBackupPassword
            pendingBackupPassword = null
            if (uri == null) {
                lifecycleScope.launch { showBackupResult(BackupWriteResult.Failed) }
                return@registerForActivityResult
            }
            lifecycleScope.launch { showBackupResult(databaseBackup.backupTo(uri, password)) }
        }

    private val openBackupLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            val password = pendingBackupPassword
            pendingBackupPassword = null
            if (uri == null) {
                lifecycleScope.launch { showRestoreResult(RestoreResult.Failed) }
                return@registerForActivityResult
            }
            lifecycleScope.launch { finishRestore(databaseBackup.restore(uri, password)) }
        }

    private val snackbarChannel = Channel<GlobalSideEffect.Snackbar>(Channel.UNLIMITED)
    private val supportDeepLinkChannel = Channel<Boolean>(Channel.BUFFERED)
    private val showUpdateChannel = Channel<Unit>(Channel.BUFFERED)
    private val verifyDeepLinkChannel = Channel<String>(Channel.BUFFERED)

    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        super.onCreate(savedInstanceState)

        handleAccountDeepLinkIntent(intent)

        installSplashScreen().apply {
            setKeepOnScreenCondition { !viewModel.container.stateFlow.value.isAppLoaded }
        }

        setContent {
            val context = LocalContext.current
            val resources = LocalResources.current
            val isTv = isRunningOnTv()
            val uiState by viewModel.collectAsState()
            val scope = rememberCoroutineScope()

            LaunchedEffect(uiState.isAppLoaded) {
                if (uiState.isAppLoaded) {
                    viewModel.syncLocale()
                }
            }

            val toaster = rememberToasterState()
            var showVpnPermissionDialog by remember { mutableStateOf(false) }
            var pendingAutoConnectPermission by rememberSaveable { mutableStateOf(false) }
            var autoConnectPermissionRequest by rememberSaveable { mutableStateOf(false) }
            var coldStartAutoUpdate by remember {
                mutableStateOf(intent?.getBooleanExtra(EXTRA_AUTO_UPDATE, false) == true)
            }
            var coldStartShowUpdate by remember {
                mutableStateOf(intent?.getBooleanExtra(EXTRA_SHOW_UPDATE, false) == true)
            }
            var vpnPermissionDenied by remember { mutableStateOf(false) }
            var requestingTunnelMode by remember {
                mutableStateOf<Pair<TunnelMode?, TunnelConfig?>>(Pair(null, null))
            }
            var pendingNotificationAction by remember {
                mutableStateOf<NotificationPendingAction?>(null)
            }
            var showLocalNetworkRationale by remember { mutableStateOf(false) }
            var hasPromptedLocalNetwork by rememberSaveable { mutableStateOf(false) }

            var pendingExport by remember { mutableStateOf<GlobalSideEffect.ExportFile?>(null) }
            val requestPermissionLauncher =
                rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    isGranted ->
                    val export = pendingExport
                    pendingExport = null
                    if (isGranted && export != null) {
                        lifecycleScope.launch { fileExportCoordinator.execute(export) }
                    }
                }

            fun startExport(export: GlobalSideEffect.ExportFile) {
                if (fileExportCoordinator.needsWritePermission(export.uri)) {
                    pendingExport = export
                    requestPermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                } else {
                    lifecycleScope.launch { fileExportCoordinator.execute(export) }
                }
            }

            val localNetworkPermissionLauncher =
                rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.RequestPermission(),
                ) { isGranted ->
                    if (!isGranted) {
                        val canAskAgain =
                            ActivityCompat.shouldShowRequestPermissionRationale(
                                this,
                                Manifest.permission.ACCESS_LOCAL_NETWORK,
                            )

                        if (!canAskAgain) {
                            val intent =
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                    data = Uri.fromParts("package", packageName, null)
                                }
                            startActivity(intent)
                        } else {
                            toaster.show(
                                message =
                                    resources.getString(R.string.local_network_permission_denied),
                                type = ToastType.Warning,
                                duration = 6000.milliseconds,
                            )
                        }
                    }
                }

            LaunchedEffect(uiState.isAppLoaded) {
                if (
                    uiState.isAppLoaded &&
                        !hasPromptedLocalNetwork &&
                        LocalNetworkPermissionHelper.shouldRequestPermission() &&
                        !LocalNetworkPermissionHelper.isPermissionGranted(context)
                ) {
                    hasPromptedLocalNetwork = true
                    showLocalNetworkRationale = true
                }
            }

            val session by authRepository.session.collectAsStateWithLifecycle()

            val initialRoute =
                when (session) {
                    is SessionState.Active,
                    is SessionState.Unknown -> Route.Tunnels
                    is SessionState.Blocked -> Route.AccessBlocked
                    is SessionState.Expired -> Route.SessionExpired
                    else -> Route.Login
                }

            val startingStack = buildList {
                add(initialRoute)
                if (intent?.action == Intent.ACTION_APPLICATION_PREFERENCES) add(Route.Settings)
                if (
                    intent?.getBooleanExtra(EXTRA_OPEN_SUPPORT, false) == true ||
                        intent?.getBooleanExtra(EXTRA_SHOW_UPDATE, false) == true
                ) {
                    add(Route.Support)
                }
            }

            val backStack = rememberNavBackStack(*startingStack.toTypedArray())
            var previousRoute by remember { mutableStateOf<Route?>(null) }

            val navController =
                rememberNavController(
                    backStack,
                    onChange = { previousKey -> previousRoute = previousKey as? Route },
                    onExitApp = { finish() },
                )

            var startDecided by rememberSaveable { mutableStateOf(false) }

            LaunchedEffect(uiState.isAppLoaded) {
                if (!uiState.isAppLoaded || startDecided) return@LaunchedEffect
                startDecided = true
                if (pendingVerifyDeepLink) return@LaunchedEffect

                val redirect =
                    resolveStartRedirect(
                        accountSettingsRepository.serverUrl(),
                        authRepository.session.value,
                    )
                if (redirect != null) navController.resetTo(redirect)
            }

            LaunchedEffect(uiState.isAppLoaded, session, backStack.lastOrNull()) {
                if (!uiState.isAppLoaded) return@LaunchedEffect
                val current = backStack.lastOrNull()
                when (session) {
                    is SessionState.Blocked ->
                        if (current != Route.AccessBlocked && current !is Route.Support) {
                            navController.resetTo(Route.AccessBlocked)
                        }
                    is SessionState.Expired ->
                        if (current != Route.SessionExpired && current !is Route.Support) {
                            navController.resetTo(Route.SessionExpired)
                        }
                    else -> Unit
                }
            }

            LaunchedEffect(uiState.isAppLoaded) {
                if (!uiState.isAppLoaded) return@LaunchedEffect
                for (token in verifyDeepLinkChannel) {
                    pendingVerifyDeepLink = false
                    if (token.isBlank()) continue
                    when (authRepository.session.value) {
                        is SessionState.Active ->
                            viewModel.postSideEffect(
                                GlobalSideEffect.Snackbar(
                                    StringValue.StringResource(R.string.account_already_active),
                                    ToastType.Info,
                                ),
                            )
                        is SessionState.Blocked,
                        is SessionState.Expired ->
                            viewModel.postSideEffect(
                                GlobalSideEffect.Snackbar(
                                    StringValue.StringResource(
                                        R.string.account_verify_link_ignored,
                                    ),
                                    ToastType.Warning,
                                ),
                            )
                        else -> {
                            // The link only selects the screen. Verifying needs an explicit tap.
                            verificationViewModel.offerDeepLink(token)
                            navController.resetTo(Route.Login, Route.VerifyPending())
                        }
                    }
                }
            }

            val vpnActivity =
                rememberLauncherForActivityResult(
                    ActivityResultContracts.StartActivityForResult(),
                    onResult = {
                        val autoRequest = autoConnectPermissionRequest
                        autoConnectPermissionRequest = false
                        if (it.resultCode != RESULT_OK) {
                            if (autoRequest) {
                                pendingAutoConnectPermission = false
                                autoConnector.reset()
                            }
                            showVpnPermissionDialog = true
                            vpnPermissionDenied = true
                        } else {
                            vpnPermissionDenied = false
                            showVpnPermissionDialog = false
                            if (autoRequest) {
                                lifecycleScope.launch { autoConnector.onPermissionGranted() }
                            } else {
                                val (appMode, config) = requestingTunnelMode
                                when (appMode) {
                                    TunnelMode.VPN ->
                                        if (config != null) viewModel.startTunnel(config)
                                    TunnelMode.LOCK_DOWN ->
                                        viewModel.setAppMode(TunnelMode.LOCK_DOWN)
                                    else -> Unit
                                }
                            }
                        }
                        requestingTunnelMode = Pair(null, null)
                    },
                )

            LaunchedEffect(Unit) {
                if (autoConnector.pendingTunnelId != null) {
                    pendingAutoConnectPermission = true
                }
                autoConnector.events.collect { event ->
                    when (event) {
                        is AutoConnectEvent.NeedsPermission -> {
                            pendingAutoConnectPermission = true
                            viewModel.postSideEffect(
                                GlobalSideEffect.Snackbar(
                                    StringValue.StringResource(R.string.auto_connect_connecting),
                                    ToastType.Info,
                                ),
                            )
                        }
                        is AutoConnectEvent.Connected ->
                            viewModel.postSideEffect(
                                GlobalSideEffect.Snackbar(
                                    StringValue.StringResource(R.string.auto_connect_connected),
                                    ToastType.Success,
                                ),
                            )
                        is AutoConnectEvent.Failed ->
                            viewModel.postSideEffect(
                                GlobalSideEffect.Snackbar(
                                    StringValue.StringResource(R.string.auto_connect_failed),
                                    ToastType.Error,
                                ),
                            )
                    }
                }
            }

            val lifecycleState by lifecycle.currentStateAsState()
            LaunchedEffect(
                uiState.isAppLoaded,
                lifecycleState,
                pendingAutoConnectPermission,
                session,
                backStack.lastOrNull(),
            ) {
                if (!pendingAutoConnectPermission || !uiState.isAppLoaded) return@LaunchedEffect
                if (session !is SessionState.Active) {
                    pendingAutoConnectPermission = false
                    return@LaunchedEffect
                }
                if (autoConnector.pendingTunnelId == null) {
                    pendingAutoConnectPermission = false
                    return@LaunchedEffect
                }
                if (!lifecycleState.isAtLeast(Lifecycle.State.RESUMED)) return@LaunchedEffect
                if ((backStack.lastOrNull() as? Route).isAuthScreen()) return@LaunchedEffect

                pendingAutoConnectPermission = false
                val permissionIntent = VpnService.prepare(this@MainActivity)
                if (permissionIntent == null) {
                    lifecycleScope.launch { autoConnector.onPermissionGranted() }
                } else {
                    autoConnectPermissionRequest = true
                    vpnActivity.launch(permissionIntent)
                }
            }

            val notificationPermissionLauncher =
                rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    when (val action = pendingNotificationAction) {
                        is NotificationPendingAction.StartTunnel ->
                            viewModel.startTunnel(action.config)
                        null -> Unit
                    }
                    pendingNotificationAction = null
                }

            LaunchedEffect(uiState.isAppLoaded, coldStartAutoUpdate) {
                if (!uiState.isAppLoaded || !coldStartAutoUpdate) return@LaunchedEffect
                coldStartAutoUpdate = false
                notificationService.remove(UPDATE_AVAILABLE_NOTIFICATION_ID)
                viewModel.requestSupportAutoUpdate(startDownload = true)
            }

            LaunchedEffect(uiState.isAppLoaded, coldStartShowUpdate) {
                if (!uiState.isAppLoaded || !coldStartShowUpdate) return@LaunchedEffect
                coldStartShowUpdate = false
                // Kept across recreation otherwise, which would scroll again on rotation
                intent?.removeExtra(EXTRA_SHOW_UPDATE)
                viewModel.requestShowUpdateStatus()
            }

            LaunchedEffect(Unit) {
                for (unit in showUpdateChannel) {
                    if (previousRoute !is Route.Support) {
                        navController.push(Route.Support)
                    }
                    viewModel.requestShowUpdateStatus()
                }
            }

            LaunchedEffect(Unit) {
                for (autoUpdate in supportDeepLinkChannel) {
                    notificationService.remove(UPDATE_AVAILABLE_NOTIFICATION_ID)
                    if (previousRoute !is Route.Support) {
                        navController.push(Route.Support)
                    }
                    viewModel.requestSupportAutoUpdate(startDownload = autoUpdate)
                }
            }

            LaunchedEffect(Unit) {
                viewModel.globalSideEffect.collectLatest { sideEffect ->
                    when (sideEffect) {
                        GlobalSideEffect.PopBackStack -> navController.pop()
                        is GlobalSideEffect.RequestVpnPermission -> {
                            requestingTunnelMode =
                                Pair(sideEffect.requestingMode, sideEffect.config)
                            vpnActivity.launch(VpnService.prepare(this@MainActivity))
                        }
                        is GlobalSideEffect.RequestNotificationPermission -> {
                            pendingNotificationAction = sideEffect.pendingAction
                            notificationPermissionLauncher.launch(
                                Manifest.permission.POST_NOTIFICATIONS,
                            )
                        }
                        is GlobalSideEffect.Snackbar -> snackbarChannel.send(sideEffect)
                        is GlobalSideEffect.LaunchUrl -> context.openWebUrl(sideEffect.url)
                        is GlobalSideEffect.InstallApk -> context.installApk(sideEffect.apk)
                        is GlobalSideEffect.ExportFile -> startExport(sideEffect)
                    }
                }
            }

            if (!uiState.isAppLoaded) return@setContent

            // Refresh tiles on tunnel size changes to catch deletes and adds
            LaunchedEffect(uiState.tunnelNames.size) { TunnelTileRefresher.refresh(context) }

            LaunchedEffect(Unit) {
                var currentToast: Toast? = null
                var lastShownTime = 0L

                for (sideEffect in snackbarChannel) {
                    val now = System.currentTimeMillis()
                    val timeSinceLastToast = now - lastShownTime

                    // If we have an active toast and hasn't shown for 2 seconds
                    if (currentToast != null && timeSinceLastToast < 2_000L) {
                        delay(2_000L - timeSinceLastToast)
                    }

                    // Dismiss current
                    currentToast?.let { toaster.dismiss(it) }

                    // Show new toast
                    currentToast =
                        toaster.show(
                            message = sideEffect.message.asString(context),
                            type = sideEffect.type,
                            duration = (sideEffect.durationMs ?: 4_000L).milliseconds,
                        )
                    lastShownTime = System.currentTimeMillis()
                }
            }

            val unlocked by appLockManager.unlocked.collectAsStateWithLifecycle()
            val showLock = uiState.pinLockEnabled && !unlocked

            // Keeps tunnels out of the recents screenshot and the app's reopen animation
            LaunchedEffect(uiState.pinLockEnabled) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    setRecentsScreenshotEnabled(!uiState.pinLockEnabled)
                }
            }

            CompositionLocalProvider(
                LocalIsAndroidTV provides isTv,
                LocalNavController provides navController,
                LocalAppLocked provides showLock,
            ) {
                UmbraVpnTheme(theme = uiState.theme) {
                    VpnDeniedDialog(
                        showVpnPermissionDialog,
                        onDismiss = {
                            showVpnPermissionDialog = false
                            vpnPermissionDenied = false
                        },
                    )

                    if (showLocalNetworkRationale) {
                        LocalNetworkPermissionDialog(
                            onDismiss = {
                                showLocalNetworkRationale = false
                                toaster.show(
                                    message =
                                        resources.getString(
                                            R.string.local_network_permission_denied,
                                        ),
                                    type = ToastType.Warning,
                                    duration = 6000.milliseconds,
                                )
                            },
                            onAttest = {
                                showLocalNetworkRationale = false

                                localNetworkPermissionLauncher.launch(
                                    Manifest.permission.ACCESS_LOCAL_NETWORK,
                                )
                            },
                        )
                    }

                    val strictSplitNotice by
                        viewModel.strictSplitNotice.collectAsStateWithLifecycle()
                    strictSplitNotice
                        ?.takeUnless { showLock }
                        ?.let { notice ->
                            val openAdvanced = {
                                // Back from Advanced lands on Settings, as if opened from there
                                navController.popUpTo(Route.Settings)
                                navController.push(Route.Advanced)
                            }
                            when (notice) {
                                StrictSplitNotice.ENABLED ->
                                    StrictSplitNoticeSheet(
                                        notice = notice,
                                        onConfirm = viewModel::acknowledgeStrictSplitNotice,
                                        onSecondary = {
                                            viewModel.acknowledgeStrictSplitNotice()
                                            openAdvanced()
                                        },
                                        onDismiss = viewModel::acknowledgeStrictSplitNotice,
                                    )
                                StrictSplitNotice.SUGGESTED ->
                                    StrictSplitNoticeSheet(
                                        notice = notice,
                                        onConfirm = { viewModel.answerStrictSplitSuggestion(true) },
                                        onSecondary = {
                                            viewModel.answerStrictSplitSuggestion(false)
                                        },
                                        onDismiss = {
                                            viewModel.answerStrictSplitSuggestion(false)
                                        },
                                    )
                            }
                        }

                    val isPinVisible by remember { derivedStateOf { showLock } }

                    val currentRoute by remember {
                        derivedStateOf { backStack.lastOrNull() as? Route }
                    }

                    LaunchedEffect(
                        uiState.isScreenRecordingProtectionEnabled,
                        currentRoute,
                        isPinVisible,
                    ) {
                        val isSecureRoute = currentRoute is SecureRoute

                        val shouldProtect =
                            uiState.isScreenRecordingProtectionEnabled &&
                                (isSecureRoute || isPinVisible)

                        if (shouldProtect) {
                            window.setFlags(
                                WindowManager.LayoutParams.FLAG_SECURE,
                                WindowManager.LayoutParams.FLAG_SECURE,
                            )
                        } else {
                            delay(500L)
                            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                            awaitCancellation()
                        }
                    }

                    Box(modifier = Modifier.fillMaxSize()) {
                        // Composed behind the lock so unlocking reveals a screen that is already
                        // laid
                        // out. While locked it is hidden from accessibility and cannot take focus.
                        Box(modifier = Modifier.fillMaxSize().lockedContent(showLock)) {
                            val currentTab by remember {
                                derivedStateOf { Tab.fromRoute(currentRoute ?: Route.Tunnels) }
                            }
                            val screenDirty by viewModel.screenDirty.collectAsStateWithLifecycle()
                            val navState by
                                currentRouteAsNavbarState(
                                    uiState,
                                    viewModel,
                                    currentRoute,
                                    navController,
                                    screenDirty,
                                )

                            Box(modifier = Modifier.fillMaxSize()) {
                                if (uiState.tunnelMode == TunnelMode.LOCK_DOWN) {
                                    AppAlertBanner(
                                        stringResource(R.string.locked_down)
                                            .uppercase(Locale.current.platformLocale),
                                        OffWhite,
                                        AlertRed,
                                        modifier = Modifier.fillMaxWidth().zIndex(2f),
                                    )
                                }
                                Scaffold(
                                    topBar = { DynamicTopAppBar(navState) },
                                    bottomBar = {
                                        if (navState.showBottomItems) {
                                            BottomNavbar(
                                                currentTab,
                                                onTabSelected = { tab ->
                                                    navController.popUpTo(tab.startRoute)
                                                },
                                            )
                                        }
                                    },
                                ) { padding ->
                                    Column(
                                        modifier =
                                            Modifier.fillMaxSize()
                                                .background(MaterialTheme.colorScheme.surface)
                                                .padding(
                                                    top = padding.calculateTopPadding().plus(8.dp),
                                                    bottom = padding.calculateBottomPadding(),
                                                )
                                                .consumeWindowInsets(padding),
                                    ) {
                                        BackHandler(enabled = uiState.selectedTunnelCount > 0) {
                                            viewModel.clearSelectedTunnels()
                                        }
                                        AppNavDisplay(
                                            backStack = backStack,
                                            navController = navController,
                                            previousRoute = previousRoute,
                                            currentRoute = currentRoute,
                                            session = session,
                                            onSwitchAccount = {
                                                lifecycleScope.launch {
                                                    logoutCoordinator.logout()
                                                    navController.resetTo(Route.Login)
                                                }
                                            },
                                            onOpenSupport = { navController.push(Route.Support) },
                                            onSessionExpiredSignIn = {
                                                navController.resetTo(Route.Login)
                                            },
                                        )
                                    }
                                }
                                // Toasts draw in their own window above the lock, so they wait for
                                // unlock
                                if (!showLock) {
                                    AppToaster(toaster)
                                }
                            }
                        }

                        val lockAlpha = remember { Animatable(if (showLock) 1f else 0f) }
                        LaunchedEffect(showLock) {
                            if (showLock) lockAlpha.snapTo(1f)
                            else lockAlpha.animateTo(0f, tween(durationMillis = LOCK_FADE_OUT_MS))
                        }
                        if (showLock || lockAlpha.value > 0f) {
                            Box(
                                modifier =
                                    Modifier.fillMaxSize().graphicsLayer {
                                        alpha = if (showLock) 1f else lockAlpha.value
                                    },
                            ) {
                                PinLockOverlay(active = showLock, backKey = backStack.size) {
                                    finish()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun handleAccountDeepLinkIntent(intent: Intent?): Boolean {
        if (intent?.action != Intent.ACTION_VIEW) return false
        val uri = intent.data ?: return false
        if (uri.scheme != "umbravpn" || uri.host != "verify") return false
        val path = uri.path
        if (path != null && path.isNotEmpty() && path != "/" && path != "/verify") return false
        val token = uri.getQueryParameter("token")?.trim().orEmpty()
        if (token.isEmpty()) return false

        pendingVerifyDeepLink = true
        verifyDeepLinkChannel.trySend(token)
        return true
    }

    override fun onStart() {
        super.onStart()
        // Before the first frame back, rather than after the foreground event reaches the lock
        appLockManager.relockIfExpired()
    }

    fun beginBackup(password: String?) {
        pendingBackupPassword = password
        if (isRunningOnTv()) {
            lifecycleScope.launch {
                showBackupResult(databaseBackup.backupTo(uri = null, password))
            }
        } else {
            createBackupLauncher.launch(databaseBackup.newBackupFileName())
        }
    }

    fun beginRestore(password: String?) {
        pendingBackupPassword = password
        openBackupLauncher.launch(
            arrayOf(
                FileUtils.ZIP_FILE_MIME_TYPE,
                FileUtils.OCTET_STREAM_MIME_TYPE,
                "application/vnd.sqlite3",
                FileUtils.ALL_FILE_TYPES,
            ),
        )
    }

    fun restoreFromUri(uri: Uri, password: String?) {
        lifecycleScope.launch { finishRestore(databaseBackup.restore(uri, password)) }
    }

    private suspend fun finishRestore(result: RestoreResult) {
        if (result == RestoreResult.Success) {
            restartProcess()
        } else {
            showRestoreResult(result)
        }
    }

    private suspend fun showBackupResult(result: BackupWriteResult) {
        val message =
            when (result) {
                BackupWriteResult.Success ->
                    StringValue.StringResource(R.string.backup_success) to ToastType.Success
                is BackupWriteResult.SavedToDownloads ->
                    StringValue.StringResource(R.string.backup_saved_downloads, result.fileName) to
                        ToastType.Success
                BackupWriteResult.PasswordRequired ->
                    StringValue.StringResource(R.string.backup_password_required) to ToastType.Error
                BackupWriteResult.Failed ->
                    StringValue.StringResource(R.string.backup_failed) to ToastType.Error
            }
        viewModel.postSideEffect(GlobalSideEffect.Snackbar(message.first, message.second))
    }

    private suspend fun showRestoreResult(result: RestoreResult) {
        val message =
            when (result) {
                RestoreResult.WrongPassword -> R.string.restore_failed_wrong_password
                RestoreResult.InvalidFile -> R.string.restore_failed_invalid_file
                RestoreResult.NewerVersion -> R.string.restore_failed_newer_version
                RestoreResult.Failed,
                RestoreResult.Success -> R.string.restore_failed
            }
        viewModel.postSideEffect(
            GlobalSideEffect.Snackbar(
                StringValue.StringResource(message),
                ToastType.Error,
            ),
        )
    }

    private fun restartProcess() {
        val intent =
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            }
        startActivity(intent)
        finishAffinity()
        exitProcess(0)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAccountDeepLinkIntent(intent)
        enqueueSupportDeepLink(intent)
    }

    private fun enqueueSupportDeepLink(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_SHOW_UPDATE, false) == true) {
            intent.removeExtra(EXTRA_SHOW_UPDATE)
            showUpdateChannel.trySend(Unit)
        }
        if (intent?.getBooleanExtra(EXTRA_OPEN_SUPPORT, false) != true) return
        val autoUpdate = intent.getBooleanExtra(EXTRA_AUTO_UPDATE, false)
        intent.removeExtra(EXTRA_OPEN_SUPPORT)
        intent.removeExtra(EXTRA_AUTO_UPDATE)
        supportDeepLinkChannel.trySend(autoUpdate)
    }
}

private const val LOCK_FADE_OUT_MS = 220

private fun Route?.isAuthScreen(): Boolean =
    this is Route.Login ||
        this is Route.Onboarding ||
        this is Route.Register ||
        this is Route.VerifyPending ||
        this is Route.ForgotPassword ||
        this is Route.ResetPassword

private fun Modifier.lockedContent(locked: Boolean): Modifier =
    this.then(if (locked) Modifier.clearAndSetSemantics {} else Modifier)
        .focusProperties { onEnter = { if (locked) cancelFocusChange() } }
        .focusGroup()
