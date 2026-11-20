package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminQuotaUser
import space.ivlev.umbravpn.domain.model.admin.AdminStatsPeriod
import space.ivlev.umbravpn.domain.model.admin.AdminTopDevice
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminStatsUiState
import space.ivlev.umbravpn.viewmodel.AdminStatsViewModel

@Composable
fun AdminStatsScreen(viewModel: AdminStatsViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "header") { AccountHeader(title = stringResource(R.string.admin_hub_stats)) }

            when {
                state.overview == null && state.isLoading ->
                    item(key = "loading") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                state.overview == null && state.error != null ->
                    item(key = "error") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            AdminErrorCard(state.error ?: AdminMessage.Unknown)
                            AccountLoadingButton(
                                text = stringResource(R.string.admin_retry),
                                onClick = viewModel::retry,
                            )
                        }
                    }
                else -> {
                    state.overview?.let { overview ->
                        item(key = "overview") { AdminStatsOverview(overview) }
                    }
                    item(key = "quota") { AdminQuotaSummary(state) }
                    item(key = "period") { AdminPeriodSelector(state.period, viewModel::setPeriod) }
                    item(key = "chart") { AdminTrafficCard(state, viewModel::retry) }
                    item(key = "devices") { AdminTopDevicesCard(state.topDevices) }
                    item(key = "users") { AdminTopUsersCard(state) }
                }
            }
        }
    }
}

@Composable
private fun AdminStatsOverview(overview: AdminOverview) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AdminStatTile(
                value = overview.users.toString(),
                label = stringResource(R.string.admin_hub_users),
                modifier = Modifier.weight(1f),
            )
            AdminStatTile(
                value = overview.devices.toString(),
                label = stringResource(R.string.admin_hub_devices),
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AdminStatTile(
                value =
                    stringResource(
                        R.string.admin_stats_nodes_value,
                        overview.nodesOnline,
                        overview.nodesTotal,
                    ),
                label = stringResource(R.string.admin_hub_nodes),
                modifier = Modifier.weight(1f),
            )
            AdminStatTile(
                value = overview.interfaces.toString(),
                label = stringResource(R.string.admin_hub_interfaces),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun AdminQuotaSummary(state: AdminStatsUiState) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = stringResource(R.string.admin_stats_quota),
                style = MaterialTheme.typography.titleSmall,
            )
            val used = AccountFormat.bytes(state.quotaUsedBytes)
            val total = state.quotaTotalBytes
            Text(
                text =
                    if (total == null) {
                        stringResource(R.string.admin_stats_quota_unlimited, used)
                    } else {
                        stringResource(
                            R.string.admin_stats_quota_value,
                            used,
                            AccountFormat.bytes(total),
                        )
                    },
                style = MaterialTheme.typography.bodyMedium,
            )
            if (state.quotaExceededCount > 0) {
                Text(
                    text =
                        stringResource(
                            R.string.admin_stats_quota_exceeded,
                            state.quotaExceededCount,
                        ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            state.quotaError?.let {
                Text(
                    text = adminMessageText(it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun AdminPeriodSelector(
    selected: AdminStatsPeriod,
    onSelect: (AdminStatsPeriod) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AdminStatsPeriod.entries.forEach { period ->
            FilterChip(
                selected = selected == period,
                onClick = { onSelect(period) },
                label = { Text(adminStatsPeriodLabel(period)) },
            )
        }
    }
}

@Composable
private fun AdminTrafficCard(state: AdminStatsUiState, onRetry: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.admin_stats_traffic),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                if (state.isSeriesLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
            Text(
                text =
                    stringResource(
                        R.string.admin_stats_sum,
                        AccountFormat.bytes(state.sumRx + state.sumTx),
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.admin_stats_peak, AccountFormat.bytes(state.peak)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when {
                state.seriesError != null ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        AdminErrorCard(state.seriesError)
                        TextButton(onClick = onRetry) { Text(stringResource(R.string.admin_retry)) }
                    }
                state.series.isEmpty() && !state.isSeriesLoading ->
                    Text(
                        text = stringResource(R.string.admin_stats_empty_period),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                    )
                else -> {
                    AdminTrafficChart(
                        points = state.series,
                        modifier = Modifier.fillMaxWidth().height(160.dp),
                    )
                    AdminTrafficLegend()
                }
            }
        }
    }
}

@Composable
private fun AdminTopDevicesCard(devices: List<AdminTopDevice>) {
    AdminStatsSection(
        title = stringResource(R.string.admin_stats_top_devices),
        emptyText = stringResource(R.string.admin_stats_empty),
        isEmpty = devices.isEmpty(),
    ) {
        devices.forEach { device ->
            AdminRankRow(
                title = device.name,
                value = AccountFormat.bytes(device.total),
                badge =
                    if (device.online) {
                        stringResource(R.string.admin_node_online)
                    } else {
                        null
                    },
            )
        }
    }
}

@Composable
private fun AdminTopUsersCard(state: AdminStatsUiState) {
    AdminStatsSection(
        title = stringResource(R.string.admin_stats_top_users),
        emptyText =
            if (state.quotaError != null) {
                adminMessageText(state.quotaError)
            } else {
                stringResource(R.string.admin_stats_no_users)
            },
        isEmpty = state.topUsers.isEmpty(),
    ) {
        state.topUsers.forEach { user -> AdminQuotaUserRow(user) }
    }
}

@Composable
private fun AdminStatsSection(
    title: String,
    emptyText: String,
    isEmpty: Boolean,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleSmall)
            if (isEmpty) {
                Text(
                    text = emptyText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            } else {
                content()
            }
        }
    }
}

@Composable
private fun AdminRankRow(title: String, value: String, badge: String? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        badge?.let { AdminChip(text = it) }
        Text(text = value, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun AdminQuotaUserRow(user: AdminQuotaUser) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = user.email,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (user.exceeded) {
                AdminChip(text = stringResource(R.string.admin_stats_exceeded), emphasized = true)
            }
            Text(
                text =
                    if (user.quotaBytes == null) {
                        AccountFormat.bytes(user.usedBytes)
                    } else {
                        stringResource(
                            R.string.admin_stats_quota_value,
                            AccountFormat.bytes(user.usedBytes),
                            AccountFormat.bytes(user.quotaBytes),
                        )
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AccountFormat.percent(user.percent)?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
private fun adminStatsPeriodLabel(period: AdminStatsPeriod): String =
    stringResource(
        when (period) {
            AdminStatsPeriod.Day24 -> R.string.admin_stats_period_day
            AdminStatsPeriod.Week7 -> R.string.admin_stats_period_week
            AdminStatsPeriod.Month30 -> R.string.admin_stats_period_month
        },
    )
