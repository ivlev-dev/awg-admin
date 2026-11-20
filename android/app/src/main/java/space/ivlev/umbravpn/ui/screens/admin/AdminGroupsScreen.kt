package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminGroupDialog
import space.ivlev.umbravpn.ui.state.AdminGroupsUiState
import space.ivlev.umbravpn.viewmodel.AdminGroupsViewModel

@Composable
fun AdminGroupsScreen(viewModel: AdminGroupsViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshIfLoaded() }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    AdminGroupDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onDelete = viewModel::delete,
    )

    PullToRefreshBox(
        isRefreshing = state.isRefreshing || (state.isLoading && state.isLoaded),
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "actions") {
                FilledTonalButton(onClick = { navController.push(Route.AdminGroupForm()) }) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text(
                        text = stringResource(R.string.admin_groups_create),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
            item(key = "counter") {
                Text(
                    text = stringResource(R.string.admin_groups_count, state.items.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }

            when {
                !state.isLoaded && state.isLoading ->
                    item(key = "loading") {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                !state.isLoaded && state.error != null ->
                    item(key = "error") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            AdminErrorCard(state.error ?: AdminMessage.Unknown)
                            AccountLoadingButton(
                                text = stringResource(R.string.admin_retry),
                                onClick = viewModel::retry,
                            )
                        }
                    }
                state.isLoaded && state.items.isEmpty() ->
                    item(key = "empty") {
                        Text(
                            text = stringResource(R.string.admin_groups_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
            }

            if (state.isLoaded && state.error != null && state.items.isNotEmpty()) {
                item(key = "inline-error") { AdminErrorCard(state.error ?: AdminMessage.Unknown) }
            }

            items(state.items, key = { it.id }) { group ->
                AdminGroupCard(
                    group = group,
                    onPools = { navController.push(Route.AdminPools(group.id)) },
                    onEdit = { navController.push(Route.AdminGroupForm(group.id)) },
                    onDelete = { viewModel.showDelete(group) },
                )
            }
        }
    }
}

@Composable
private fun AdminGroupDialogs(
    state: AdminGroupsUiState,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val dialog = state.dialog as? AdminGroupDialog.Delete ?: return
    InfoDialog(
        onAttest = onDelete,
        onDismiss = onDismiss,
        title = stringResource(R.string.admin_group_delete_title),
        body = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    stringResource(
                        R.string.admin_group_delete_body,
                        dialog.name,
                        dialog.interfaces,
                        dialog.devices,
                    ),
                )
                state.dialogError?.let { AdminErrorCard(it) }
            }
        },
        confirmText = stringResource(R.string.delete),
        confirmEnabled = !state.isActionInProgress,
        destructive = true,
    )
}
