package space.ivlev.umbravpn.ui.screens.admin

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
import space.ivlev.umbravpn.ui.state.AdminTariffDialog
import space.ivlev.umbravpn.ui.state.AdminTariffsUiState
import space.ivlev.umbravpn.viewmodel.AdminTariffsViewModel

@Composable
fun AdminTariffsScreen(viewModel: AdminTariffsViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshIfLoaded() }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    AdminTariffDeleteDialog(
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
                FilledTonalButton(
                    onClick = { navController.push(Route.AdminTariffForm()) },
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Text(
                        text = stringResource(R.string.admin_tariffs_create),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
            if (state.isLoaded) {
                item(key = "counter") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.admin_tariffs_count, state.items.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                        if (state.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                            )
                        }
                    }
                }
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
                            text = stringResource(R.string.admin_tariffs_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
            }

            if (state.isLoaded && state.error != null && state.items.isNotEmpty()) {
                item(key = "inline-error") { AdminErrorCard(state.error ?: AdminMessage.Unknown) }
            }

            items(state.items, key = { it.id }) { tariff ->
                AdminTariffCard(
                    tariff = tariff,
                    onEdit = { navController.push(Route.AdminTariffForm(tariff.id)) },
                    onDelete = { viewModel.showDelete(tariff.id, tariff.name) },
                )
            }
        }
    }
}

@Composable
private fun AdminTariffDeleteDialog(
    state: AdminTariffsUiState,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val dialog = state.dialog as? AdminTariffDialog.Delete ?: return
    InfoDialog(
        onAttest = onDelete,
        onDismiss = onDismiss,
        title = stringResource(R.string.admin_tariff_delete_title),
        body = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.admin_tariff_delete_body, dialog.name))
                state.dialogError?.let { AdminErrorCard(it) }
            }
        },
        confirmText = stringResource(R.string.delete),
        confirmEnabled = !state.isActionInProgress,
        destructive = true,
    )
}
