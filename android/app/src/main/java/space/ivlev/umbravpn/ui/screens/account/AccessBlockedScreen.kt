package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.account.BlockReason
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.ui.screens.account.components.AccountSecondaryButton

@Composable
fun AccessBlockedScreen(
    reason: BlockReason,
    email: String?,
    onSwitchAccount: () -> Unit,
    onSupport: () -> Unit,
) {
    val title =
        stringResource(
            when (reason) {
                BlockReason.Disabled -> R.string.access_blocked_disabled_title
                BlockReason.Rejected -> R.string.access_blocked_rejected_title
            },
        )
    val body =
        stringResource(
            when (reason) {
                BlockReason.Disabled -> R.string.access_blocked_disabled_body
                BlockReason.Rejected -> R.string.access_blocked_rejected_body
            },
            email?.takeIf { it.isNotBlank() } ?: stringResource(R.string.account_unknown),
        )

    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.size(72.dp),
        ) {
            Icon(
                Icons.Outlined.Shield,
                contentDescription = null,
                modifier = Modifier.padding(20.dp),
            )
        }

        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )

        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center,
        )

        AccountLoadingButton(
            text = stringResource(R.string.access_blocked_switch_account),
            onClick = onSwitchAccount,
        )

        AccountSecondaryButton(
            text = stringResource(R.string.access_blocked_support),
            onClick = onSupport,
        )
    }
}
