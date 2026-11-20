package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.AdminSection
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountCard
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.viewmodel.AdminHubViewModel

private data class AdminHubItem(
    val titleRes: Int,
    val subtitleRes: Int,
    val icon: ImageVector,
    val route: Route,
)

@Composable
fun AdminHubScreen(viewModel: AdminHubViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    val items =
        listOf(
            AdminHubItem(
                R.string.admin_hub_users,
                R.string.admin_hub_users_hint,
                Icons.Outlined.People,
                Route.AdminUsers,
            ),
            AdminHubItem(
                R.string.admin_hub_tariffs,
                R.string.admin_hub_tariffs_hint,
                Icons.Outlined.Payments,
                Route.AdminTariffs,
            ),
            AdminHubItem(
                R.string.admin_hub_nodes,
                R.string.admin_hub_nodes_hint,
                Icons.Outlined.Dns,
                Route.AdminNodes,
            ),
            AdminHubItem(
                R.string.admin_hub_interfaces,
                R.string.admin_hub_interfaces_hint,
                Icons.Outlined.SettingsEthernet,
                Route.AdminInterfaces,
            ),
            AdminHubItem(
                R.string.admin_hub_groups,
                R.string.admin_hub_groups_hint,
                Icons.Outlined.Groups,
                Route.AdminGroups,
            ),
            AdminHubItem(
                R.string.admin_hub_audit,
                R.string.admin_hub_audit_hint,
                Icons.Outlined.History,
                Route.AdminAudit,
            ),
            AdminHubItem(
                R.string.admin_hub_stats,
                R.string.admin_hub_stats_hint,
                Icons.Outlined.BarChart,
                Route.AdminStats,
            ),
            AdminHubItem(
                R.string.admin_hub_settings,
                R.string.admin_hub_settings_hint,
                Icons.Outlined.Settings,
                Route.AdminSettings,
            ),
        )

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            modifier =
                Modifier.fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AccountHeader(
                title = stringResource(R.string.admin_hub_title),
                subtitle = stringResource(R.string.admin_hub_subtitle),
            )

            when {
                state.overview == null && state.error == null ->
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                state.overview == null && state.error != null ->
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AdminErrorCard(state.error ?: AdminMessage.Unknown)
                        AccountLoadingButton(
                            text = stringResource(R.string.admin_retry),
                            onClick = viewModel::retry,
                            loading = state.isLoading,
                        )
                    }
                else -> {
                    val overview = state.overview ?: return@Column
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AdminMetric(
                            value = overview.users.toString(),
                            label = stringResource(R.string.admin_hub_users),
                            modifier = Modifier.weight(1f),
                        )
                        AdminMetric(
                            value = overview.devices.toString(),
                            label = stringResource(R.string.admin_hub_devices),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AdminMetric(
                            value =
                                stringResource(
                                    R.string.admin_hub_nodes_value,
                                    overview.nodesOnline,
                                    overview.nodesTotal,
                                ),
                            label = stringResource(R.string.admin_hub_nodes),
                            modifier = Modifier.weight(1f),
                        )
                        AdminMetric(
                            value = overview.interfaces.toString(),
                            label = stringResource(R.string.admin_hub_interfaces),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (state.pendingUsers > 0) {
                        AdminChip(
                            text =
                                stringResource(
                                    R.string.admin_hub_pending_count,
                                    state.pendingUsers,
                                ),
                            emphasized = true,
                        )
                    }
                    if (state.error != null) {
                        AdminErrorCard(state.error ?: AdminMessage.Unknown)
                    }
                    items.chunked(2).forEach { rowItems ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            rowItems.forEach { item ->
                                val value =
                                    when (item.route) {
                                        Route.AdminUsers -> overview.users.toString()
                                        Route.AdminNodes ->
                                            stringResource(
                                                R.string.admin_hub_nodes_value,
                                                overview.nodesOnline,
                                                overview.nodesTotal,
                                            )
                                        Route.AdminInterfaces -> overview.interfaces.toString()
                                        Route.AdminGroups -> overview.groups.toString()
                                        Route.AdminStats ->
                                            AccountFormat.bytes(overview.today.total)
                                        Route.AdminAudit ->
                                            state.recentAudit?.let {
                                                if (state.hasMoreAudit) "$it+" else it.toString()
                                            }
                                        Route.AdminSettings ->
                                            state.retentionDays?.let {
                                                stringResource(
                                                    R.string.admin_hub_retention_value,
                                                    it,
                                                )
                                            }
                                        else -> null
                                    }
                                AdminHubCard(
                                    icon = item.icon,
                                    title = stringResource(item.titleRes),
                                    subtitle = stringResource(item.subtitleRes),
                                    value = value,
                                    onClick = { navController.push(item.route) },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (rowItems.size == 1) {
                                Box(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AdminAccessDeniedScreen() {
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.size(64.dp),
        ) {
            Icon(
                Icons.Outlined.AdminPanelSettings,
                contentDescription = null,
                modifier = Modifier.padding(18.dp),
            )
        }
        Text(
            text = stringResource(R.string.admin_access_denied),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.admin_access_denied_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun AdminMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(text = value, style = MaterialTheme.typography.titleMedium)
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun AdminPlaceholderScreen(section: AdminSection) {
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AccountHeader(title = stringResource(section.titleRes))
        AccountCard {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = stringResource(R.string.admin_in_development),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = stringResource(R.string.admin_in_development_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
