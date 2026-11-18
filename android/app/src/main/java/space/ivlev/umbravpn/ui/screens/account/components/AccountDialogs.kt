package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.state.AccountDialog
import space.ivlev.umbravpn.ui.state.AccountUiState

@Composable
fun AccountDialogs(
    state: AccountUiState,
    onDismiss: () -> Unit,
    onCreateDevice: (String) -> Unit,
    onRenameDevice: (String, String) -> Unit,
    onDeleteDevice: (String) -> Unit,
    onLogout: () -> Unit,
    onChangeServer: (String) -> Unit,
) {
    when (val dialog = state.dialog) {
        AccountDialog.AddDevice -> {
            var name by rememberSaveable(dialog) { mutableStateOf("") }
            InfoDialog(
                onAttest = { onCreateDevice(name) },
                onDismiss = onDismiss,
                title = stringResource(R.string.account_add_device),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AccountFormField(
                            value = name,
                            onValueChange = { name = it },
                            label = stringResource(R.string.account_device_name),
                            error = state.dialogError,
                            enabled = !state.isActionInProgress,
                        )
                        Text(
                            text = stringResource(R.string.account_add_device_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                },
                confirmText = stringResource(R.string.create),
                confirmEnabled = name.isNotBlank() && !state.isActionInProgress,
            )
        }
        is AccountDialog.RenameDevice -> {
            var name by rememberSaveable(dialog) { mutableStateOf(dialog.currentName) }
            InfoDialog(
                onAttest = { onRenameDevice(dialog.id, name) },
                onDismiss = onDismiss,
                title = stringResource(R.string.account_rename_device),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AccountFormField(
                            value = name,
                            onValueChange = { name = it },
                            label = stringResource(R.string.account_device_name),
                            error = state.dialogError,
                            enabled = !state.isActionInProgress,
                        )
                    }
                },
                confirmText = stringResource(R.string.save),
                confirmEnabled = name.isNotBlank() && !state.isActionInProgress,
            )
        }
        is AccountDialog.DeleteDevice -> {
            InfoDialog(
                onAttest = { onDeleteDevice(dialog.id) },
                onDismiss = onDismiss,
                title = stringResource(R.string.account_delete_device),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text =
                                stringResource(
                                    R.string.account_delete_device_message,
                                    dialog.name,
                                ),
                        )
                        state.dialogError?.let { AccountErrorCard(it) }
                    }
                },
                confirmText = stringResource(R.string.delete),
                confirmEnabled = !state.isActionInProgress,
            )
        }
        AccountDialog.Logout -> {
            InfoDialog(
                onAttest = onLogout,
                onDismiss = onDismiss,
                title = stringResource(R.string.account_logout),
                body = { Text(stringResource(R.string.account_logout_message)) },
                confirmText = stringResource(R.string.account_logout),
                confirmEnabled = !state.isActionInProgress,
            )
        }
        AccountDialog.ChangeServer -> {
            var url by rememberSaveable(dialog) { mutableStateOf(state.serverUrl) }
            InfoDialog(
                onAttest = { onChangeServer(url) },
                onDismiss = onDismiss,
                title = stringResource(R.string.account_change_server),
                body = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = stringResource(R.string.account_change_server_warning),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        AccountFormField(
                            value = url,
                            onValueChange = { url = it },
                            label = stringResource(R.string.account_server_url),
                            error = state.dialogError,
                            enabled = !state.isActionInProgress,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        )
                    }
                },
                confirmText = stringResource(R.string.save),
                confirmEnabled = url.isNotBlank() && !state.isActionInProgress,
            )
        }
        null -> Unit
    }
}
