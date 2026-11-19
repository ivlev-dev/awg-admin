package space.ivlev.umbravpn.ui.screens.tunnels.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollableDefaults
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.overscroll
import androidx.compose.foundation.rememberOverscrollEffect
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import sh.calvin.reorderable.rememberReorderableLazyListState
import space.ivlev.umbravpn.ui.LocalIsAndroidTV
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.scroll.appScrollbar
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.pin.LocalAppLocked
import space.ivlev.umbravpn.ui.state.TunnelListRow
import space.ivlev.umbravpn.ui.state.TunnelsUiState
import space.ivlev.umbravpn.ui.state.applyDisplayedOrder
import space.ivlev.umbravpn.ui.state.buildTunnelListRows
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TunnelList(
    uiState: TunnelsUiState,
    modifier: Modifier = Modifier,
    viewModel: SharedAppViewModel,
) {
    val navController = LocalNavController.current
    val isTv = LocalIsAndroidTV.current
    val hapticFeedback = LocalHapticFeedback.current

    val focusRequester = remember { FocusRequester() }
    var editableRows by remember { mutableStateOf(uiState.rows) }

    val locked = LocalAppLocked.current
    // Waits for the PIN lock, which holds focus while it covers this screen
    LaunchedEffect(locked) {
        if (isTv && !locked) {
            focusRequester.requestFocus()
        }
    }

    val lazyListState = rememberLazyListState()

    fun persistRows(rows: List<TunnelListRow>) {
        val (groups, tunnels) =
            applyDisplayedOrder(
                rows,
                uiState.groups,
                uiState.tunnels,
                uiState.reorderScopeGroupId,
            )
        viewModel.applyReorderDraft(groups, tunnels)
    }

    fun moveRow(from: Int, to: Int) {
        editableRows = editableRows.toMutableList().apply { add(to, removeAt(from)) }
        persistRows(editableRows)
    }

    val reorderableLazyListState =
        rememberReorderableLazyListState(
            lazyListState,
            scrollThresholdPadding = WindowInsets.systemBars.asPaddingValues(),
        ) { from, to ->
            editableRows =
                editableRows.toMutableList().apply { add(to.index, removeAt(from.index)) }
            persistRows(editableRows)
            hapticFeedback.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
        }

    LaunchedEffect(
        uiState.isReorderMode,
        uiState.reorderScopeGroupId,
        uiState.groups,
        uiState.tunnels,
    ) {
        if (uiState.isReorderMode && !reorderableLazyListState.isAnyItemDragging) {
            editableRows =
                buildTunnelListRows(
                    groups = uiState.groups,
                    tunnels = uiState.tunnels,
                    activeTunnelIds = uiState.backendStatus.activeTunnels.keys,
                    collapseGroups = uiState.reorderScopeGroupId == null,
                    scopeGroupId = uiState.reorderScopeGroupId,
                )
        }
    }

    val rows = if (uiState.isReorderMode) editableRows else uiState.rows
    val isSyncing by viewModel.isSyncingTunnels.collectAsStateWithLifecycle()

    PullToRefreshBox(
        isRefreshing = isSyncing,
        onRefresh = viewModel::refreshTunnels,
        modifier = modifier,
    ) {
        LazyColumn(
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.Top),
            modifier =
                Modifier.fillMaxSize()
                    .then(
                        if (uiState.isReorderMode) Modifier
                        else
                            Modifier.pointerInput(Unit) {
                                detectTapGestures {
                                    if (uiState.tunnels.isEmpty() && uiState.groups.isEmpty()) {
                                        return@detectTapGestures
                                    }
                                    viewModel.clearSelectedTunnels()
                                }
                            },
                    )
                    .overscroll(rememberOverscrollEffect())
                    .appScrollbar(
                        state = lazyListState.scrollIndicatorState,
                        orientation = Orientation.Vertical,
                    ),
            state = lazyListState,
            userScrollEnabled = true,
            reverseLayout = false,
            flingBehavior = ScrollableDefaults.flingBehavior(),
        ) {
            if (uiState.tunnels.isEmpty() && uiState.groups.isEmpty()) {
                item {
                    GettingStartedSection(
                        modifier = Modifier.animateItem(),
                    )
                }
                return@LazyColumn
            }

            itemsIndexed(
                items = rows,
                key = { _, row -> row.key },
                contentType = { _, row -> row.javaClass },
            ) { index, row ->
                if (uiState.isReorderMode) {
                    ReorderableTunnelRow(
                        reorderableState = reorderableLazyListState,
                        row = row,
                        index = index,
                        rowCount = rows.size,
                        uiState = uiState,
                        isTv = isTv,
                        onEnterScope = viewModel::enterReorderScope,
                        onMove = ::moveRow,
                    )
                } else {
                    TunnelListRowContent(
                        row = row,
                        uiState = uiState,
                        viewModel = viewModel,
                        isTv = isTv,
                        isDragging = false,
                        focusRequester = if (index == 0) focusRequester else null,
                        onNavigateTunnel = { navController.push(Route.TunnelSettings(it)) },
                        modifier = Modifier.animateItem(),
                    )
                }
            }
        }
    }
}
