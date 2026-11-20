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
import space.ivlev.umbravpn.ui.state.AdminNodeDialog
import space.ivlev.umbravpn.ui.state.AdminNodesUiState
import space.ivlev.umbravpn.viewmodel.AdminNodesViewModel

@Composable
fun AdminNodesScreen(viewModel: AdminNodesViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshIfLoaded() }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    AdminNodeDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onDelete = viewModel::delete,
        onRotate = viewModel::rotate,
    )
    state.revealedToken?.let { token ->
        AdminTokenDialog(reveal = token, onDismiss = viewModel::dismissToken)
    }

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
                FilledTonalButton(onClick = { navController.push(Route.AdminNodeForm) }) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text(
                        text = stringResource(R.string.admin_nodes_create),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
            item(key = "counter") {
                Text(
                    text = stringResource(R.string.admin_nodes_count, state.items.size),
                    style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.outline,
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
                            text = stringResource(R.string.admin_nodes_empty),
                            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.outline,
                        )
                    }
            }

            if (state.isLoaded && state.error != null && state.items.isNotEmpty()) {
                item(key = "inline-error") { AdminErrorCard(state.error ?: AdminMessage.Unknown) }
            }

            items(state.items, key = { it.id }) { node ->
                AdminNodeCard(
                    node = node,
                    onRotate = { viewModel.showRotate(node.id, node.name) },
                    onDelete = { viewModel.showDelete(node.id, node.name) },
                )
            }
        }
    }
}

@Composable
private fun AdminNodeDialogs(
    state: AdminNodesUiState,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    onRotate: () -> Unit,
) {
    when (val dialog = state.dialog) {
        is AdminNodeDialog.Delete ->
            InfoDialog(
                onAttest = onDelete,
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_node_delete_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_node_delete_body, dialog.name))
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.delete),
                confirmEnabled = !state.isActionInProgress,
                destructive = true,
            )
        is AdminNodeDialog.Rotate ->
            InfoDialog(
                onAttest = onRotate,
                onDismiss = onDismiss,
                title = stringResource(R.string.admin_node_rotate_title),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.admin_node_rotate_body, dialog.name))
                        state.dialogError?.let { AdminErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.admin_node_rotate),
                confirmEnabled = !state.isActionInProgress,
                destructive = true,
            )
        null -> Unit
    }
}
