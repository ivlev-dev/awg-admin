package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.admin.AdminAuditDetails
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.admin.AdminAuditEntry
import space.ivlev.umbravpn.domain.model.admin.AdminAuditField
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPeriod
import space.ivlev.umbravpn.ui.common.functions.rememberClipboardHelper
import space.ivlev.umbravpn.ui.screens.account.components.AccountHeader
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminAuditListState
import space.ivlev.umbravpn.ui.state.AdminListFooter
import space.ivlev.umbravpn.viewmodel.AdminAuditViewModel

@Composable
fun AdminAuditScreen(viewModel: AdminAuditViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val list = state.list

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    state.detail?.let { entry ->
        AdminAuditDetailDialog(entry = entry, onDismiss = viewModel::dismissDetail)
    }

    PullToRefreshBox(
        isRefreshing = list.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "header") { AccountHeader(title = stringResource(R.string.admin_hub_audit)) }
            item(key = "filters") {
                AdminAuditFilters(
                    list = list,
                    onActorChange = viewModel::setActor,
                    onActionChange = viewModel::setAction,
                    onEntityChange = viewModel::setEntity,
                    onPeriodChange = viewModel::setPeriod,
                    onClear = viewModel::clearFilters,
                )
            }
            item(key = "counter") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = stringResource(R.string.admin_audit_count, list.items.size),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    if (list.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                }
            }

            when {
                !list.isLoaded && list.isLoading ->
                    item(key = "loading") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                !list.isLoaded && list.error != null ->
                    item(key = "error") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            AdminErrorCard(list.error ?: AdminMessage.Unknown)
                            AccountLoadingButton(
                                text = stringResource(R.string.admin_retry),
                                onClick = viewModel::retry,
                            )
                        }
                    }
                list.isEmpty ->
                    item(key = "empty") {
                        AdminEmptyCard(stringResource(R.string.admin_audit_empty))
                    }
            }

            items(list.items, key = { it.id }) { entry ->
                AdminAuditRow(entry = entry, onClick = { viewModel.select(entry) })
            }

            item(key = "footer") { AdminAuditFooter(list, viewModel::loadMore, viewModel::retry) }
        }
    }
}

@Composable
private fun AdminAuditFilters(
    list: AdminAuditListState,
    onActorChange: (String) -> Unit,
    onActionChange: (String) -> Unit,
    onEntityChange: (String) -> Unit,
    onPeriodChange: (AdminAuditPeriod) -> Unit,
    onClear: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AdminField(
            value = list.actor,
            onValueChange = onActorChange,
            label = stringResource(R.string.admin_audit_filter_actor),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AdminField(
                value = list.action,
                onValueChange = onActionChange,
                label = stringResource(R.string.admin_audit_filter_action),
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
            AdminField(
                value = list.entity,
                onValueChange = onEntityChange,
                label = stringResource(R.string.admin_audit_filter_entity),
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AdminAuditPeriod.entries.forEach { period ->
                FilterChip(
                    selected = list.period == period,
                    onClick = { onPeriodChange(period) },
                    label = { Text(adminAuditPeriodLabel(period)) },
                )
            }
        }
        if (list.hasFilters || list.period != AdminAuditPeriod.All) {
            TextButton(onClick = onClear) {
                Text(stringResource(R.string.admin_audit_clear_filters))
            }
        }
    }
}

@Composable
private fun AdminAuditRow(entry: AdminAuditEntry, onClick: () -> Unit) {
    androidx.compose.material3.Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        colors =
            androidx.compose.material3.CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
        border =
            androidx.compose.foundation.BorderStroke(
                1.dp,
                MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
            ),
        elevation = androidx.compose.material3.CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = adminAuditTime(entry.at),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.weight(1f),
                )
                AdminChip(
                    text =
                        if (entry.succeeded) {
                            stringResource(R.string.admin_audit_status_ok)
                        } else {
                            stringResource(R.string.admin_audit_status_failed, entry.status)
                        },
                    emphasized = entry.succeeded,
                )
            }
            Text(
                text = entry.displayActor,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AdminChip(text = entry.action.ifBlank { "—" })
                AdminChip(
                    text =
                        entry.entity.ifBlank { "—" } +
                            (entry.entityId?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                )
            }
        }
    }
}

@Composable
private fun AdminAuditFooter(
    list: AdminAuditListState,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    when (list.footer) {
        AdminListFooter.None -> Unit
        AdminListFooter.Loading ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        AdminListFooter.Error ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AdminErrorCard(list.error ?: AdminMessage.Unknown)
                TextButton(onClick = onRetry) { Text(stringResource(R.string.admin_retry)) }
            }
        AdminListFooter.LoadMore ->
            TextButton(
                onClick = onLoadMore,
                enabled = list.canLoadMore,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.admin_users_load_more))
            }
        AdminListFooter.End ->
            Text(
                text = stringResource(R.string.admin_audit_end),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            )
    }
}

@Composable
fun AdminAuditDetailDialog(entry: AdminAuditEntry, onDismiss: () -> Unit) {
    val clipboard = rememberClipboardHelper()
    val fields = adminAuditFields(entry)
    val copyAll = fields.joinToString("\n") { "${it.name}: ${it.value}" }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.admin_audit_detail_title)) },
        confirmButton = {
            TextButton(onClick = { clipboard.copy(copyAll) }) {
                Text(stringResource(R.string.admin_audit_copy_all))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.admin_close)) }
        },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                fields.forEachIndexed { index, field ->
                    if (index > 0) HorizontalDivider()
                    AdminAuditDetailField(
                        field = field,
                        onCopy = { clipboard.copy(field.value) },
                    )
                }
            }
        },
    )
}

@Composable
private fun AdminAuditDetailField(field: AdminAuditField, onCopy: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = field.name,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = field.value,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.weight(1f),
            )
            if (!field.redacted) {
                IconButton(onClick = onCopy) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = stringResource(R.string.copy),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun adminAuditFields(entry: AdminAuditEntry): List<AdminAuditField> = buildList {
    add(AdminAuditField(stringResource(R.string.admin_audit_field_time), adminAuditTime(entry.at)))
    add(
        AdminAuditField(
            stringResource(R.string.admin_audit_field_actor),
            entry.displayActor,
        ),
    )
    add(AdminAuditField(stringResource(R.string.admin_audit_field_action), entry.action))
    add(AdminAuditField(stringResource(R.string.admin_audit_field_entity), entry.entity))
    entry.entityId
        ?.takeIf { it.isNotBlank() }
        ?.let { add(AdminAuditField(stringResource(R.string.admin_audit_field_entity_id), it)) }
    add(
        AdminAuditField(
            stringResource(R.string.admin_audit_field_status),
            entry.status.toString(),
        ),
    )
    entry.ip
        ?.takeIf { it.isNotBlank() }
        ?.let { add(AdminAuditField(stringResource(R.string.admin_audit_field_ip), it)) }
    add(AdminAuditField(stringResource(R.string.admin_audit_field_id), entry.id))
    addAll(AdminAuditDetails.fields(entry.details))
}

@Composable
private fun adminAuditPeriodLabel(period: AdminAuditPeriod): String =
    stringResource(
        when (period) {
            AdminAuditPeriod.All -> R.string.admin_audit_period_all
            AdminAuditPeriod.Day24 -> R.string.admin_audit_period_day
            AdminAuditPeriod.Week7 -> R.string.admin_audit_period_week
            AdminAuditPeriod.Month30 -> R.string.admin_audit_period_month
        },
    )

private fun adminAuditTime(instant: Instant?): String =
    instant?.let {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .withZone(ZoneId.systemDefault())
            .format(it)
    } ?: "—"

@Composable
internal fun AdminEmptyCard(text: String) {
    androidx.compose.material3.Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(16.dp),
        )
    }
}
