package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminFormSideEffect
import space.ivlev.umbravpn.viewmodel.AdminGroupFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminInterfaceFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminNodeFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminPoolFormViewModel

@Composable
fun AdminNodeFormScreen(viewModel: AdminNodeFormViewModel) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    viewModel.collectSideEffect { effect ->
        if (effect is AdminFormSideEffect.Saved) {
            navController.pop()
        }
    }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    state.revealedToken?.let { token ->
        AdminTokenDialog(reveal = token, onDismiss = viewModel::dismissToken)
    }

    AccountFormScaffold(title = stringResource(R.string.admin_node_create_title)) {
        state.error?.let { AdminErrorCard(it) }

        AdminField(
            value = state.name,
            onValueChange = viewModel::onNameChange,
            label = stringResource(R.string.admin_node_name),
            error = state.nameError,
            enabled = !state.isSaving,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        )
        Text(
            text = stringResource(R.string.admin_node_address_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = stringResource(R.string.admin_node_token_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        AccountLoadingButton(
            text = stringResource(R.string.admin_create),
            onClick = viewModel::save,
            loading = state.isSaving,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
fun AdminInterfaceFormScreen(viewModel: AdminInterfaceFormViewModel) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    viewModel.collectSideEffect { effect ->
        if (effect is AdminFormSideEffect.Saved) {
            navController.pop()
        }
    }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }
    if (state.isLoading) {
        LoadingPlaceholder()
        return
    }

    AccountFormScaffold(
        title =
            stringResource(
                if (state.isEditing) {
                    R.string.admin_interface_edit_title
                } else {
                    R.string.admin_interface_create_title
                },
            ),
    ) {
        state.error?.let { AdminErrorCard(it) }

        AdminSelectField(
            label = stringResource(R.string.admin_interface_group),
            selected = state.groups.firstOrNull { it.id == state.groupId },
            options = state.groups,
            enabled = !state.isSaving && !state.isEditing,
            allowNone = false,
            onSelect = { viewModel.onGroupChange(it?.id) },
        )
        state.groupError?.let { AdminFieldError(it) }
        AdminSelectField(
            label = stringResource(R.string.admin_interface_node),
            selected = state.nodes.firstOrNull { it.id == state.nodeId },
            options = state.nodes,
            enabled = !state.isSaving && !state.isEditing,
            allowNone = false,
            onSelect = { viewModel.onNodeChange(it?.id) },
        )
        state.nodeError?.let { AdminFieldError(it) }
        AdminField(
            value = state.name,
            onValueChange = viewModel::onNameChange,
            label = stringResource(R.string.admin_interface_name),
            error = state.nameError,
            enabled = !state.isSaving && !state.isEditing,
        )
        AdminField(
            value = state.label,
            onValueChange = viewModel::onLabelChange,
            label = stringResource(R.string.admin_interface_label),
            enabled = !state.isSaving,
        )
        AdminField(
            value = state.endpointHost,
            onValueChange = viewModel::onHostChange,
            label = stringResource(R.string.admin_interface_endpoint_host),
            error = state.hostError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.endpointPort,
            onValueChange = viewModel::onEndpointPortChange,
            label = stringResource(R.string.admin_interface_endpoint_port),
            error = state.endpointPortError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.listenPort,
            onValueChange = viewModel::onListenPortChange,
            label = stringResource(R.string.admin_interface_listen_port),
            error = state.listenPortError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.mtu,
            onValueChange = viewModel::onMtuChange,
            label = stringResource(R.string.admin_interface_mtu),
            error = state.mtuError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        )
        if (state.isEditing) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(R.string.admin_interface_enabled),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Switch(
                    checked = state.enabled,
                    onCheckedChange = viewModel::onEnabledChange,
                    enabled = !state.isSaving,
                )
            }
        }

        AccountLoadingButton(
            text =
                stringResource(
                    if (state.isEditing) R.string.admin_save else R.string.admin_create,
                ),
            onClick = viewModel::save,
            loading = state.isSaving,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
fun AdminGroupFormScreen(viewModel: AdminGroupFormViewModel) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    viewModel.collectSideEffect { effect ->
        if (effect is AdminFormSideEffect.Saved) {
            navController.pop()
        }
    }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }
    if (state.isLoading) {
        LoadingPlaceholder()
        return
    }

    AccountFormScaffold(
        title =
            stringResource(
                if (state.isEditing) R.string.admin_group_edit_title
                else R.string.admin_group_create_title,
            ),
    ) {
        state.error?.let { AdminErrorCard(it) }

        AdminField(
            value = state.name,
            onValueChange = viewModel::onNameChange,
            label = stringResource(R.string.admin_group_name),
            error = state.nameError,
            enabled = !state.isSaving,
        )
        AdminField(
            value = state.description,
            onValueChange = viewModel::onDescriptionChange,
            label = stringResource(R.string.admin_group_description),
            enabled = !state.isSaving,
        )
        AdminField(
            value = state.baseCidr,
            onValueChange = viewModel::onCidrChange,
            label = stringResource(R.string.admin_group_base_cidr),
            error = state.cidrError,
            enabled = !state.isSaving,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        )
        Text(
            text = stringResource(R.string.admin_group_cidr_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = stringResource(R.string.admin_group_forwarding),
                style = MaterialTheme.typography.bodyLarge,
            )
            Switch(
                checked = state.forwardingDefault,
                onCheckedChange = viewModel::onForwardingChange,
                enabled = !state.isSaving,
            )
        }
        Text(
            text = stringResource(R.string.admin_group_forwarding_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )

        AccountLoadingButton(
            text =
                stringResource(
                    if (state.isEditing) R.string.admin_save else R.string.admin_create,
                ),
            onClick = viewModel::save,
            loading = state.isSaving,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
fun AdminPoolFormScreen(viewModel: AdminPoolFormViewModel) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current

    viewModel.collectSideEffect { effect ->
        if (effect is AdminFormSideEffect.Saved) {
            navController.pop()
        }
    }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }
    if (state.isLoading) {
        LoadingPlaceholder()
        return
    }

    val modeOptions =
        listOf(
            AdminOption(AdminPoolMode.Auto.apiValue, stringResource(R.string.admin_pool_mode_auto)),
            AdminOption(
                AdminPoolMode.RfOnly.apiValue,
                stringResource(R.string.admin_pool_mode_rf_only),
            ),
            AdminOption(
                AdminPoolMode.ExternalOnly.apiValue,
                stringResource(R.string.admin_pool_mode_external_only),
            ),
        )

    AccountFormScaffold(
        title =
            stringResource(
                if (state.isEditing) R.string.admin_pool_edit_title
                else R.string.admin_pool_create_title,
            ),
    ) {
        state.error?.let { AdminErrorCard(it) }

        AdminField(
            value = state.name,
            onValueChange = viewModel::onNameChange,
            label = stringResource(R.string.admin_pool_name),
            error = state.nameError,
            enabled = !state.isSaving && !state.isEditing,
        )
        AdminField(
            value = state.cidr,
            onValueChange = viewModel::onCidrChange,
            label = stringResource(R.string.admin_pool_cidr),
            error = state.cidrError,
            enabled = !state.isSaving && !state.isEditing,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.gateway,
            onValueChange = viewModel::onGatewayChange,
            label = stringResource(R.string.admin_pool_gateway),
            error = state.gatewayError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
        )
        AdminSelectField(
            label = stringResource(R.string.admin_pool_mode),
            selected = modeOptions.firstOrNull { it.id == state.mode.apiValue },
            options = modeOptions,
            enabled = !state.isSaving,
            allowNone = false,
            onSelect = { option ->
                AdminPoolMode.entries
                    .firstOrNull { it.apiValue == option?.id }
                    ?.let(
                        viewModel::onModeChange,
                    )
            },
        )
        if (state.isEditing) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(R.string.admin_pool_enabled),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Switch(
                    checked = state.enabled,
                    onCheckedChange = viewModel::onEnabledChange,
                    enabled = !state.isSaving,
                )
            }
        }

        AccountLoadingButton(
            text =
                stringResource(
                    if (state.isEditing) R.string.admin_save else R.string.admin_create,
                ),
            onClick = viewModel::save,
            loading = state.isSaving,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun AdminFieldError(message: space.ivlev.umbravpn.domain.admin.AdminMessage) {
    Text(
        text = adminMessageText(message),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(start = 12.dp),
    )
}
