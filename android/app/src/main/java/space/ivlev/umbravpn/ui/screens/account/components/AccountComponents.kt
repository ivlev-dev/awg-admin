package space.ivlev.umbravpn.ui.screens.account.components

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage
import space.ivlev.umbravpn.ui.common.textbox.CustomTextField

@StringRes
fun accountMessageRes(message: AccountMessage): Int =
    when (message) {
        AccountMessage.EmptyEmail -> R.string.account_error_empty_email
        AccountMessage.InvalidEmail -> R.string.account_error_invalid_email
        AccountMessage.EmptyPassword -> R.string.account_error_empty_password
        AccountMessage.PasswordTooShort -> R.string.account_error_password_short
        AccountMessage.PasswordMismatch -> R.string.passwords_do_not_match
        AccountMessage.EmptyToken -> R.string.account_error_empty_token
        AccountMessage.EmptyDeviceName -> R.string.account_error_device_name
        AccountMessage.EmptyInterface -> R.string.account_error_interfaces_empty
        AccountMessage.EmptyTunnelLabel -> R.string.account_error_empty_tunnel_label
        AccountMessage.TunnelLabelTooLong -> R.string.account_error_tunnel_label_long
        AccountMessage.ServerUrlEmpty -> R.string.account_error_server_empty
        AccountMessage.ServerUrlInvalid -> R.string.account_error_server_invalid
        AccountMessage.ServerUrlUnsupportedScheme -> R.string.account_error_server_scheme
        AccountMessage.ServerUrlInsecure -> R.string.account_error_server_insecure
        AccountMessage.InvalidCredentials -> R.string.account_error_invalid_credentials
        AccountMessage.TotpRequired -> R.string.account_error_totp_required
        AccountMessage.TotpInvalid -> R.string.account_error_totp_invalid
        AccountMessage.TooManyAttempts -> R.string.account_error_too_many_attempts
        AccountMessage.Network -> R.string.account_error_network
        AccountMessage.ServerNotConfigured -> R.string.account_error_server_not_configured
        AccountMessage.SessionExpired -> R.string.account_error_session_expired
        AccountMessage.EmailNotVerified -> R.string.account_error_email_not_verified
        AccountMessage.EmptyFullName -> R.string.account_error_full_name_empty
        AccountMessage.FullNameTooLong -> R.string.account_error_full_name_long
        AccountMessage.PendingApproval -> R.string.account_error_pending_approval
        AccountMessage.Rejected -> R.string.account_error_rejected
        AccountMessage.AccountDisabled -> R.string.account_error_account_disabled
        AccountMessage.TariffRequired -> R.string.account_error_tariff_required
        AccountMessage.SubscriptionInactive -> R.string.account_error_subscription_inactive
        AccountMessage.DeviceLimitReached -> R.string.account_error_device_limit
        AccountMessage.RequestInProgress -> R.string.account_error_request_in_progress
        AccountMessage.IdempotencyMismatch -> R.string.account_error_idempotency_mismatch
        AccountMessage.EmailAlreadyRegistered -> R.string.account_error_email_registered
        AccountMessage.Conflicted -> R.string.account_error_conflict
        AccountMessage.LastTunnel -> R.string.account_error_last_tunnel
        AccountMessage.NotFound -> R.string.account_error_not_found
        AccountMessage.InvalidToken -> R.string.account_error_invalid_token
        AccountMessage.ServerError -> R.string.account_error_server
        AccountMessage.Unknown -> R.string.unknown_error
        AccountMessage.DeviceCreated -> R.string.account_device_created
        AccountMessage.DeviceRenamed -> R.string.account_device_renamed
        AccountMessage.DeviceDeleted -> R.string.account_device_deleted
        AccountMessage.TunnelAdded -> R.string.account_tunnel_added
        AccountMessage.TunnelDeleted -> R.string.account_tunnel_deleted
        AccountMessage.TunnelRenamed -> R.string.account_tunnel_renamed
        AccountMessage.ServerChanged -> R.string.account_server_changed
        AccountMessage.LoggedOut -> R.string.account_logged_out
        AccountMessage.EmailResent -> R.string.account_email_resent
        AccountMessage.PasswordResetSent -> R.string.account_password_reset_sent
        AccountMessage.EmailVerified -> R.string.account_email_verified
        AccountMessage.FullNameUpdated -> R.string.account_full_name_updated
        AccountMessage.ApprovalStillPending -> R.string.account_approval_still_pending
        AccountMessage.ServerReady -> R.string.account_server_ready
        AccountMessage.ServerUnavailable -> R.string.account_server_unavailable
        AccountMessage.ServerUnreachable -> R.string.account_server_unreachable
    }

@Composable
fun AccountErrorCard(message: AccountMessage, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(accountMessageRes(message)),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
fun AccountFormField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: AccountMessage? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: @Composable ((Modifier) -> Unit)? = null,
    contentType: ContentType? = null,
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
            visualTransformation = visualTransformation,
            trailing = trailing,
            modifier =
                Modifier.fillMaxWidth()
                    .then(
                        if (contentType != null) {
                            Modifier.semantics { this.contentType = contentType }
                        } else {
                            Modifier
                        },
                    ),
        )
        if (error != null) {
            Text(
                text = androidx.compose.ui.res.stringResource(accountMessageRes(error)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 12.dp, top = 4.dp),
            )
        }
    }
}

@Composable
fun AccountLoadingButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = LocalContentColor.current,
            )
        } else {
            Text(text = text)
        }
    }
}

@Composable
fun AccountSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = LocalContentColor.current,
            )
        } else {
            Text(text = text)
        }
    }
}

@Composable
fun AccountCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        tonalElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(16.dp)) { content() }
    }
}

@Composable
fun AccountInfoRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
fun AccountHeader(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(text = title, style = MaterialTheme.typography.headlineSmall)
        if (subtitle != null) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
