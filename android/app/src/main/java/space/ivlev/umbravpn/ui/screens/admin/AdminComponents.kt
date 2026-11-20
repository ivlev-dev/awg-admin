package space.ivlev.umbravpn.ui.screens.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminUser
import space.ivlev.umbravpn.ui.common.textbox.CustomTextField

fun adminMessageRes(message: AdminMessage): Int =
    when (message) {
        AdminMessage.Network -> R.string.admin_error_network
        AdminMessage.SessionExpired -> R.string.admin_error_session_expired
        AdminMessage.Forbidden -> R.string.admin_error_forbidden
        AdminMessage.NotFound -> R.string.admin_error_not_found
        is AdminMessage.Conflict -> R.string.admin_error_conflict
        AdminMessage.RateLimited -> R.string.admin_error_rate_limited
        AdminMessage.Server -> R.string.admin_error_server
        AdminMessage.Unknown -> R.string.admin_error_unknown
        AdminMessage.EmailRequired -> R.string.admin_error_email_required
        AdminMessage.EmailInvalid -> R.string.admin_error_email_invalid
        AdminMessage.PasswordRequired -> R.string.admin_error_password_required
        AdminMessage.PasswordTooShort -> R.string.admin_error_password_short
        AdminMessage.FullNameTooLong -> R.string.admin_error_full_name_long
        AdminMessage.NameRequired -> R.string.admin_error_name_required
        AdminMessage.MaxDevicesInvalid -> R.string.admin_error_max_devices
        AdminMessage.SpeedInvalid -> R.string.admin_error_speed
        AdminMessage.QuotaInvalid -> R.string.admin_error_quota
        AdminMessage.TariffRequired -> R.string.admin_error_tariff_required
        AdminMessage.HostRequired -> R.string.admin_error_host_required
        AdminMessage.HostInvalid -> R.string.admin_error_host_invalid
        AdminMessage.PortInvalid -> R.string.admin_error_port
        AdminMessage.MtuInvalid -> R.string.admin_error_mtu
        AdminMessage.CidrInvalid -> R.string.admin_error_cidr
        AdminMessage.GatewayInvalid -> R.string.admin_error_gateway
        AdminMessage.InterfaceNameInvalid -> R.string.admin_error_interface_name
        AdminMessage.NodeRequired -> R.string.admin_error_node_required
        AdminMessage.GroupRequired -> R.string.admin_error_group_required
        AdminMessage.RangeInvalid -> R.string.admin_error_range
        AdminMessage.ValueInvalid -> R.string.admin_error_value
        AdminMessage.SFloor -> R.string.admin_error_s_floor
        AdminMessage.KeepaliveInvalid -> R.string.admin_error_keepalive
        AdminMessage.HostsRequired -> R.string.admin_error_hosts
        AdminMessage.ShareTtlInvalid -> R.string.admin_error_share_ttl
        AdminMessage.RetentionInvalid -> R.string.admin_error_retention
    }

@Composable
fun adminMessageText(message: AdminMessage): String {
    val base = stringResource(adminMessageRes(message))
    return if (message is AdminMessage.Conflict && !message.detail.isNullOrBlank()) {
        "$base: ${message.detail}"
    } else {
        base
    }
}

@Composable
fun AdminErrorCard(message: AdminMessage, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Text(
            text = adminMessageText(message),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

@Composable
fun AdminField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: AdminMessage? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        CustomTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            containerColor = MaterialTheme.colorScheme.surface,
            enabled = enabled,
            singleLine = singleLine,
            isError = error != null,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Text(
                text = adminMessageText(error),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 12.dp, top = 4.dp),
            )
        }
    }
}

@Composable
fun AdminPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: AdminMessage? = null,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var visible by remember { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth()) {
        CustomTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            containerColor = MaterialTheme.colorScheme.surface,
            enabled = enabled,
            singleLine = true,
            isError = error != null,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation =
                if (visible) VisualTransformation.None else PasswordVisualTransformation(),
            trailing = { trailingModifier ->
                IconButton(
                    onClick = { visible = !visible },
                    modifier = trailingModifier,
                    enabled = enabled,
                ) {
                    Icon(
                        imageVector =
                            if (visible) Icons.Outlined.VisibilityOff
                            else Icons.Outlined.Visibility,
                        contentDescription =
                            stringResource(
                                if (visible) R.string.hide_password else R.string.show_password,
                            ),
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Text(
                text = adminMessageText(error),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 12.dp, top = 4.dp),
            )
        }
    }
}

@Composable
fun AdminSelectField(
    label: String,
    selected: AdminOption?,
    options: List<AdminOption>,
    onSelect: (AdminOption?) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    allowNone: Boolean = true,
    noneLabel: String = stringResource(R.string.admin_none),
) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box {
            Row(
                modifier =
                    Modifier.fillMaxWidth()
                        .clickable(enabled = enabled) { expanded = true }
                        .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = selected?.label ?: noneLabel,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    Icons.Filled.ArrowDropDown,
                    contentDescription = stringResource(R.string.dropdown),
                )
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                modifier = Modifier.heightIn(max = 280.dp).width(320.dp),
                scrollState = rememberScrollState(),
                containerColor = MaterialTheme.colorScheme.surface,
            ) {
                if (allowNone) {
                    DropdownMenuItem(
                        text = { Text(noneLabel) },
                        onClick = {
                            expanded = false
                            onSelect(null)
                        },
                    )
                }
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        onClick = {
                            expanded = false
                            onSelect(option)
                        },
                    )
                }
            }
        }
    }
}

@Composable
fun AdminChip(
    text: String,
    modifier: Modifier = Modifier,
    emphasized: Boolean = false,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color =
            if (emphasized) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        contentColor =
            if (emphasized) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
fun AdminHubCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    value: String? = null,
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp))
                if (value != null) {
                    Text(text = value, style = MaterialTheme.typography.titleMedium)
                }
            }
            Text(text = title, style = MaterialTheme.typography.titleSmall)
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun AdminUserCard(
    user: AdminUser,
    isPending: Boolean,
    onEdit: () -> Unit,
    onResetPassword: () -> Unit,
    onToggleDisabled: () -> Unit,
    onDelete: () -> Unit,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text =
                    user.fullName?.takeIf { it.isNotBlank() }
                        ?: stringResource(R.string.admin_user_unnamed),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = user.email,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AdminChip(
                    text =
                        stringResource(
                            if (user.role == UserRole.Admin) R.string.admin_users_role_admin
                            else R.string.admin_users_role_user,
                        ),
                    emphasized = user.role == UserRole.Admin,
                )
                AdminChip(text = userStatusLabel(user))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (isPending) {
                    IconButton(onClick = onApprove) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = stringResource(R.string.admin_action_approve),
                        )
                    }
                    IconButton(onClick = onReject) {
                        Icon(
                            Icons.Outlined.Cancel,
                            contentDescription = stringResource(R.string.admin_action_reject),
                        )
                    }
                } else {
                    IconButton(onClick = onEdit) {
                        Icon(
                            Icons.Outlined.Edit,
                            contentDescription = stringResource(R.string.admin_action_edit),
                        )
                    }
                    IconButton(onClick = onResetPassword) {
                        Icon(
                            Icons.Outlined.Key,
                            contentDescription =
                                stringResource(R.string.admin_action_reset_password),
                        )
                    }
                    IconButton(onClick = onToggleDisabled) {
                        Icon(
                            imageVector =
                                if (user.disabled) {
                                    Icons.Outlined.LockOpen
                                } else {
                                    Icons.Outlined.Lock
                                },
                            contentDescription =
                                stringResource(
                                    if (user.disabled) R.string.admin_action_unblock
                                    else R.string.admin_action_block,
                                ),
                        )
                    }
                    IconButton(onClick = onDelete) {
                        Icon(
                            Icons.Outlined.Delete,
                            contentDescription = stringResource(R.string.admin_action_delete),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun AdminTariffCard(
    tariff: AdminTariff,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val quota =
        tariff.trafficQuotaBytes?.let {
            space.ivlev.umbravpn.domain.account.AccountFormat.bytes(it)
        } ?: stringResource(R.string.admin_tariff_unlimited)
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = tariff.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = stringResource(R.string.admin_action_edit),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Outlined.Delete,
                        contentDescription = stringResource(R.string.admin_action_delete),
                    )
                }
            }
            if (tariff.description.isNotBlank()) {
                Text(
                    text = tariff.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text =
                    stringResource(R.string.admin_tariff_devices_value, tariff.maxDevices) +
                        " · " +
                        stringResource(
                            R.string.admin_tariff_speed_value,
                            tariff.deviceDownKbps,
                            tariff.deviceUpKbps,
                        ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.admin_tariff_quota_value, quota),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            tariff.interfaceName
                ?.takeIf { it.isNotBlank() }
                ?.let { name ->
                    Text(
                        text = name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
        }
    }
}

@Composable
fun userStatusLabel(user: AdminUser): String =
    when {
        user.disabled -> stringResource(R.string.admin_users_status_disabled)
        user.status == UserStatus.PendingEmail ->
            stringResource(R.string.admin_user_status_pending_email)
        user.status == UserStatus.PendingApproval ->
            stringResource(R.string.admin_user_status_pending_approval)
        user.status == UserStatus.Rejected -> stringResource(R.string.admin_user_status_rejected)
        user.status == UserStatus.Unknown -> stringResource(R.string.admin_users_filter_all)
        else -> stringResource(R.string.admin_users_status_active)
    }
