package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.admin.AdminValidation
import space.ivlev.umbravpn.domain.model.admin.AdminRoleFilter
import space.ivlev.umbravpn.domain.model.admin.AdminStatusFilter
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminUserTab
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.common.textbox.CustomTextField
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminListFooter
import space.ivlev.umbravpn.ui.state.AdminUserDialog
import space.ivlev.umbravpn.ui.state.AdminUsersUiState
import space.ivlev.umbravpn.viewmodel.AdminUsersViewModel

@Composable
fun AdminUsersScreen(viewModel: AdminUsersViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current
    val list = state.list

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshIfLoaded() }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    AdminUserDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onDelete = viewModel::delete,
        onResetPassword = viewModel::resetPassword,
        onSetDisabled = viewModel::setDisabled,
        onApprove = viewModel::approve,
        onReject = viewModel::reject,
    )

    androidx.compose.material3.pulltorefresh.PullToRefreshBox(
        isRefreshing = list.isLoading && list.isLoaded,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "actions") {
                androidx.compose.material3.FilledTonalButton(
                    onClick = { navController.push(Route.AdminUserForm()) },
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text(
                        text = stringResource(R.string.admin_users_create),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
            item(key = "tabs") {
                PrimaryTabRow(selectedTabIndex = if (list.tab == AdminUserTab.Active) 0 else 1) {
                    Tab(
                        selected = list.tab == AdminUserTab.Active,
                        onClick = { viewModel.setTab(AdminUserTab.Active) },
                        text = { Text(stringResource(R.string.admin_users_tab_active)) },
                    )
                    Tab(
                        selected = list.tab == AdminUserTab.Pending,
                        onClick = { viewModel.setTab(AdminUserTab.Pending) },
                        text = { Text(stringResource(R.string.admin_users_tab_pending)) },
                    )
                }
            }
            item(key = "search") {
                CustomTextField(
                    value = list.query,
                    onValueChange = viewModel::setQuery,
                    containerColor = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = {
                        Text(
                            text = stringResource(R.string.admin_users_search),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                )
            }
            item(key = "filters") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = list.role == AdminRoleFilter.All,
                            onClick = { viewModel.setRole(AdminRoleFilter.All) },
                            label = { Text(stringResource(R.string.admin_users_filter_all)) },
                        )
                        FilterChip(
                            selected = list.role == AdminRoleFilter.Admin,
                            onClick = { viewModel.setRole(AdminRoleFilter.Admin) },
                            label = { Text(stringResource(R.string.admin_users_role_admin)) },
                        )
                        FilterChip(
                            selected = list.role == AdminRoleFilter.User,
                            onClick = { viewModel.setRole(AdminRoleFilter.User) },
                            label = { Text(stringResource(R.string.admin_users_role_user)) },
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = list.status == AdminStatusFilter.All,
                            onClick = { viewModel.setStatus(AdminStatusFilter.All) },
                            label = { Text(stringResource(R.string.admin_users_filter_all)) },
                        )
                        FilterChip(
                            selected = list.status == AdminStatusFilter.Active,
                            onClick = { viewModel.setStatus(AdminStatusFilter.Active) },
                            label = { Text(stringResource(R.string.admin_users_status_active)) },
                        )
                        FilterChip(
                            selected = list.status == AdminStatusFilter.Disabled,
                            onClick = { viewModel.setStatus(AdminStatusFilter.Disabled) },
                            label = { Text(stringResource(R.string.admin_users_status_disabled)) },
                        )
                    }
                }
            }
            item(key = "counter") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text =
                            stringResource(R.string.admin_users_count, list.items.size, list.total),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    if (list.isLoading || list.isLoadingMore) {
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
                            AdminErrorCard(list.error)
                            AccountLoadingButton(
                                text = stringResource(R.string.admin_retry),
                                onClick = viewModel::retry,
                            )
                        }
                    }
                list.isEmpty ->
                    item(key = "empty") {
                        AccountCardText(
                            text =
                                stringResource(
                                    if (list.tab == AdminUserTab.Pending) {
                                        R.string.admin_users_empty_pending
                                    } else {
                                        R.string.admin_users_empty
                                    },
                                ),
                        )
                    }
            }

            items(list.items, key = { it.id }) { user ->
                AdminUserCard(
                    user = user,
                    isPending = list.tab == AdminUserTab.Pending,
                    onEdit = { navController.push(Route.AdminUserForm(user.id)) },
                    onResetPassword = { viewModel.showResetPassword(user) },
                    onToggleDisabled = { viewModel.showSetDisabled(user) },
                    onDelete = { viewModel.showDelete(user) },
                    onApprove = { viewModel.showApprove(user) },
                    onReject = { viewModel.showReject(user) },
                )
            }

            item(key = "footer") {
                AdminUsersFooter(
                    list = list,
                    onLoadMore = viewModel::loadMore,
                    onRetry = viewModel::retry,
                )
            }
        }
    }
}

@Composable
private fun AccountCardText(text: String) {
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

@Composable
private fun AdminUsersFooter(
    list: space.ivlev.umbravpn.ui.state.AdminUsersState,
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
        AdminListFooter.LoadMore -> {
            LaunchedEffect(list.items.size, list.query, list.tab, list.role, list.status) {
                onLoadMore()
            }
            TextButton(
                onClick = onLoadMore,
                enabled = list.canLoadMore,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.admin_users_load_more))
            }
        }
        AdminListFooter.End ->
            Text(
                text = stringResource(R.string.admin_users_end),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            )
    }
}

@Composable
private fun AdminUserDialogs(
    state: AdminUsersUiState,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    onResetPassword: (String) -> Unit,
    onSetDisabled: () -> Unit,
    onApprove: (String) -> Unit,
    onReject: () -> Unit,
) {
    when (val dialog = state.dialog) {
        is AdminUserDialog.Delete ->
            InfoDialog(
                onAttest = onDelete,
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_delete_user_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_delete_user_body, dialog.email))
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.delete),
                confirmEnabled = !state.isActionInProgress,
                destructive = true,
            )
        is AdminUserDialog.ResetPassword -> {
            var password by rememberSaveable(dialog) { mutableStateOf("") }
            val passwordError = AdminValidation.passwordError(password)
            InfoDialog(
                onAttest = { onResetPassword(password) },
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_reset_password_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_reset_password_body, dialog.email))
                        AdminPasswordField(
                            value = password,
                            onValueChange = { password = it },
                            label = stringResource(R.string.admin_new_password),
                            error = if (password.isNotEmpty()) passwordError else null,
                            enabled = !state.isActionInProgress,
                        )
                        Text(
                            text = stringResource(R.string.admin_password_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.admin_save),
                confirmEnabled = passwordError == null && !state.isActionInProgress,
            )
        }
        is AdminUserDialog.SetDisabled ->
            InfoDialog(
                onAttest = onSetDisabled,
                onDismiss = onDismiss,
                title =
                    stringResource(
                        if (dialog.disabled) R.string.admin_block_user_title
                        else R.string.admin_unblock_user_title,
                    ),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            stringResource(
                                if (dialog.disabled) R.string.admin_block_user_body
                                else R.string.admin_unblock_user_body,
                                dialog.email,
                            ),
                        )
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText =
                    stringResource(
                        if (dialog.disabled) R.string.admin_action_block
                        else R.string.admin_action_unblock,
                    ),
                confirmEnabled = !state.isActionInProgress,
            )
        is AdminUserDialog.Approve -> {
            val tariffs = state.tariffs
            var selectedId by
                rememberSaveable(dialog, tariffs) {
                    mutableStateOf(tariffs.firstOrNull()?.id.orEmpty())
                }
            InfoDialog(
                onAttest = { onApprove(selectedId) },
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_approve_user_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_approve_user_body, dialog.email))
                        if (state.isLoadingTariffs) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        } else if (tariffs.isEmpty()) {
                            Text(
                                text = stringResource(R.string.admin_no_tariffs),
                                color = MaterialTheme.colorScheme.error,
                            )
                        } else {
                            Text(
                                text = stringResource(R.string.admin_select_tariff),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            tariffs.forEach { tariff ->
                                AdminTariffChoice(
                                    tariff = tariff,
                                    selected = selectedId == tariff.id,
                                    onSelect = { selectedId = tariff.id },
                                    enabled = !state.isActionInProgress,
                                )
                            }
                        }
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.admin_action_approve),
                confirmEnabled =
                    selectedId.isNotBlank() &&
                        tariffs.any { it.id == selectedId } &&
                        !state.isActionInProgress,
            )
        }
        is AdminUserDialog.Reject ->
            InfoDialog(
                onAttest = onReject,
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_reject_user_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_reject_user_body, dialog.email))
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.admin_action_reject),
                confirmEnabled = !state.isActionInProgress,
                destructive = true,
            )
        null -> Unit
    }
}

@Composable
private fun AdminTariffChoice(
    tariff: AdminTariff,
    selected: Boolean,
    onSelect: () -> Unit,
    enabled: Boolean,
) {
    Row(
        modifier =
            Modifier.fillMaxWidth()
                .clickable(enabled = enabled, onClick = onSelect)
                .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        androidx.compose.material3.RadioButton(
            selected = selected,
            onClick = onSelect,
            enabled = enabled,
        )
        Column {
            Text(text = tariff.name, style = MaterialTheme.typography.bodyLarge)
            Text(
                text =
                    stringResource(
                        R.string.admin_tariff_devices_value,
                        tariff.maxDevices,
                    ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}
