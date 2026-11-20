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
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.state.AdminFormSideEffect
import space.ivlev.umbravpn.viewmodel.AdminTariffFormViewModel
import space.ivlev.umbravpn.viewmodel.AdminUserFormViewModel

@Composable
fun AdminUserFormScreen(viewModel: AdminUserFormViewModel) {
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
                if (state.isEditing) R.string.admin_user_edit_title
                else R.string.admin_user_create_title,
            ),
    ) {
        state.error?.let { AdminErrorCard(it) }

        AdminField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = stringResource(R.string.admin_email),
            error = state.emailError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.fullName,
            onValueChange = viewModel::onFullNameChange,
            label = stringResource(R.string.admin_full_name),
            error = state.fullNameError,
            enabled = !state.isSaving,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )
        if (!state.isEditing) {
            AdminPasswordField(
                value = state.password,
                onValueChange = viewModel::onPasswordChange,
                label = stringResource(R.string.admin_password),
                error = state.passwordError,
                enabled = !state.isSaving,
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Next,
                    ),
            )
            Text(
                text = stringResource(R.string.admin_password_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        val roleOptions =
            listOf(
                AdminOption(ROLE_ADMIN, stringResource(R.string.admin_users_role_admin)),
                AdminOption(ROLE_USER, stringResource(R.string.admin_users_role_user)),
            )
        AdminSelectField(
            label = stringResource(R.string.admin_role),
            selected = roleOptions.firstOrNull { it.id == state.role.apiValueForUi() },
            options = roleOptions,
            enabled = !state.isSaving,
            allowNone = false,
            onSelect = { option ->
                viewModel.onRoleChange(
                    if (option?.id == ROLE_ADMIN) UserRole.Admin else UserRole.User,
                )
            },
        )
        AdminSelectField(
            label = stringResource(R.string.admin_tariff),
            selected = state.catalogs.tariffs.firstOrNull { it.id == state.tariffId },
            options = state.catalogs.tariffs,
            enabled = !state.isSaving,
            onSelect = { viewModel.onTariffChange(it?.id) },
        )
        AdminSelectField(
            label = stringResource(R.string.admin_node),
            selected = state.catalogs.nodes.firstOrNull { it.id == state.nodeId },
            options = state.catalogs.nodes,
            enabled = !state.isSaving,
            onSelect = { viewModel.onNodeChange(it?.id) },
        )
        AdminSelectField(
            label = stringResource(R.string.admin_group),
            selected = state.catalogs.groups.firstOrNull { it.id == state.groupId },
            options = state.catalogs.groups,
            enabled = !state.isSaving,
            onSelect = { viewModel.onGroupChange(it?.id) },
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = stringResource(R.string.admin_user_disabled),
                style = MaterialTheme.typography.bodyLarge,
            )
            Switch(
                checked = state.disabled,
                onCheckedChange = viewModel::onDisabledChange,
                enabled = !state.isSaving,
            )
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
fun AdminTariffFormScreen(viewModel: AdminTariffFormViewModel) {
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
                if (state.isEditing) R.string.admin_tariff_edit_title
                else R.string.admin_tariff_create_title,
            ),
    ) {
        state.error?.let { AdminErrorCard(it) }

        AdminField(
            value = state.name,
            onValueChange = viewModel::onNameChange,
            label = stringResource(R.string.admin_tariff_name),
            error = state.nameError,
            enabled = !state.isSaving,
        )
        AdminField(
            value = state.description,
            onValueChange = viewModel::onDescriptionChange,
            label = stringResource(R.string.admin_tariff_description),
            enabled = !state.isSaving,
        )
        AdminField(
            value = state.maxDevices,
            onValueChange = viewModel::onMaxDevicesChange,
            label = stringResource(R.string.admin_tariff_max_devices),
            error = state.maxDevicesError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.deviceDownKbps,
            onValueChange = viewModel::onDownChange,
            label = stringResource(R.string.admin_tariff_down),
            error = state.speedError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.deviceUpKbps,
            onValueChange = viewModel::onUpChange,
            label = stringResource(R.string.admin_tariff_up),
            error = state.speedError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
        )
        AdminField(
            value = state.quotaGb,
            onValueChange = viewModel::onQuotaChange,
            label = stringResource(R.string.admin_tariff_quota),
            error = state.quotaError,
            enabled = !state.isSaving,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                    imeAction = ImeAction.Next,
                ),
        )
        Text(
            text = stringResource(R.string.admin_tariff_quota_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        AdminSelectField(
            label = stringResource(R.string.admin_tariff_interface),
            selected = state.interfaces.firstOrNull { it.id == state.interfaceId },
            options = state.interfaces,
            enabled = !state.isSaving,
            onSelect = { viewModel.onInterfaceChange(it?.id) },
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

private const val ROLE_ADMIN = "admin"
private const val ROLE_USER = "user"

private fun UserRole.apiValueForUi(): String =
    when (this) {
        UserRole.Admin -> ROLE_ADMIN
        UserRole.User,
        UserRole.Unknown -> ROLE_USER
    }
