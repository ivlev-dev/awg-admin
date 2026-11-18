package space.ivlev.umbravpn.ui.screens.settings.logs

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.dokar.sonner.ToastType
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.screens.settings.logs.components.LogList
import space.ivlev.umbravpn.ui.screens.settings.logs.components.LogsBottomSheet
import space.ivlev.umbravpn.ui.screens.tunnels.components.EmptyStateLottie
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.LoggerViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun LogsScreen(
    viewModel: LoggerViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val loggerState by viewModel.collectAsState()

    if (loggerState.isLoading) return

    val lazyColumnListState = rememberLazyListState()
    var isAutoScrolling by rememberSaveable { mutableStateOf(true) }
    var lastScrollPosition by rememberSaveable { mutableIntStateOf(0) }
    var showLogsSheet by rememberSaveable { mutableStateOf(false) }

    sharedViewModel.collectSideEffect { sideEffect ->
        if (sideEffect is LocalSideEffect.Sheet.LoggerActions) showLogsSheet = true
    }

    LaunchedEffect(isAutoScrolling) {
        if (isAutoScrolling) {
            lazyColumnListState.scrollToItem(loggerState.messages.size)
        }
    }

    LaunchedEffect(loggerState.messages.size) {
        if (isAutoScrolling) {
            lazyColumnListState.scrollToItem(loggerState.messages.size)
        }
    }

    LaunchedEffect(lazyColumnListState) {
        snapshotFlow { lazyColumnListState.firstVisibleItemIndex }
            .collect { currentScrollPosition ->
                if (currentScrollPosition < lastScrollPosition && isAutoScrolling) {
                    isAutoScrolling = false
                }
                val visible = lazyColumnListState.layoutInfo.visibleItemsInfo
                if (
                    visible.isNotEmpty() &&
                        visible.last().index ==
                            lazyColumnListState.layoutInfo.totalItemsCount - 1 &&
                        !isAutoScrolling
                ) {
                    isAutoScrolling = true
                }
                lastScrollPosition = currentScrollPosition
            }
    }

    if (showLogsSheet) {
        LogsBottomSheet(
            onExport = { uri ->
                viewModel.exportLogs(uri)
                showLogsSheet = false
            },
            onDelete = {
                viewModel.deleteLogs()
                showLogsSheet = false
            },
            onCanceled = {
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(R.string.export_canceled),
                    ToastType.Warning,
                )
                showLogsSheet = false
            },
            onDismiss = { showLogsSheet = false },
        )
    }

    AnimatedContent(
        targetState = loggerState.messages.isEmpty(),
        transitionSpec = {
            fadeIn(animationSpec = tween(250)) togetherWith fadeOut(animationSpec = tween(200))
        },
        label = "LogsContentTransition",
    ) { isEmpty ->
        if (isEmpty) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyStateLottie(message = stringResource(R.string.no_tunnels_yet))
            }
        } else {
            LogList(
                logs = loggerState.messages,
                lazyColumnListState = lazyColumnListState,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
