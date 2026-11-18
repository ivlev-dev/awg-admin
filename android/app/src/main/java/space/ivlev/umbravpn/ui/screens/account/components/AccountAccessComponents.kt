package space.ivlev.umbravpn.ui.screens.account.components

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.time.Instant
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.model.account.AccountSubscription
import space.ivlev.umbravpn.domain.model.account.SubscriptionStatus
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.ui.theme.AlertRed
import space.ivlev.umbravpn.ui.theme.SilverTree
import space.ivlev.umbravpn.ui.theme.Straw

@Composable
fun AccountStatusChip(
    status: UserStatus,
    disabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val (labelRes, color) =
        when {
            disabled -> R.string.account_status_disabled to AlertRed
            status == UserStatus.Active -> R.string.account_status_active to SilverTree
            status == UserStatus.PendingEmail || status == UserStatus.PendingApproval ->
                R.string.account_status_pending to Straw
            status == UserStatus.Rejected -> R.string.account_status_rejected to AlertRed
            else -> R.string.account_unknown to MaterialTheme.colorScheme.outline
        }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.14f),
        contentColor = color,
        border = BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Text(
            text = stringResource(labelRes),
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
fun AccountSubscriptionCard(
    subscription: AccountSubscription,
    modifier: Modifier = Modifier,
) {
    val active = subscription.isActive && subscription.grantsAccess
    val accent = if (active) SilverTree else AlertRed

    AccountCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    Icons.Outlined.CreditCard,
                    contentDescription = null,
                    modifier = Modifier.padding(10.dp),
                )
            }
            Column(
                modifier = Modifier.padding(start = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = stringResource(R.string.account_subscription_title),
                    style = MaterialTheme.typography.titleMedium,
                )
                if (subscription.planName.isNotBlank()) {
                    Text(
                        text = subscription.planName,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))

        AccountInfoRow(
            label = stringResource(R.string.account_subscription_status),
            value = stringResource(subscriptionStatusRes(subscription.status)),
        )
        AccountFormat.date(subscription.currentPeriodEnd)?.let { date ->
            AccountInfoRow(
                label =
                    stringResource(
                        if (subscription.cancelAtPeriodEnd) {
                            R.string.account_subscription_ends_at
                        } else {
                            R.string.account_subscription_period_end
                        },
                    ),
                value = date,
            )
        }
        AccountInfoRow(
            label = stringResource(R.string.account_subscription_auto_renew),
            value =
                stringResource(
                    if (subscription.autoRenew) R.string.account_subscription_enabled
                    else R.string.account_subscription_disabled,
                ),
        )

        if (!active) {
            Text(
                text = stringResource(R.string.account_subscription_inactive_warning),
                style = MaterialTheme.typography.bodySmall,
                color = accent,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
fun TrafficLimitedBanner(resetAt: Instant?, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Outlined.Speed, contentDescription = null)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.account_quota_throttled_title),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = stringResource(R.string.account_quota_throttled_message),
                    style = MaterialTheme.typography.bodyMedium,
                )
                AccountFormat.date(resetAt)?.let { date ->
                    Text(
                        text = stringResource(R.string.account_quota_throttled_reset, date),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
fun SubscriptionInactiveCard(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Outlined.CreditCard, contentDescription = null)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.account_subscription_missing_title),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = stringResource(R.string.account_subscription_missing_message),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
fun TariffMissingCard(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Straw.copy(alpha = 0.14f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, Straw.copy(alpha = 0.4f)),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Straw)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.account_tariff_missing_title),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = stringResource(R.string.account_tariff_missing_message),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

@StringRes
fun subscriptionStatusRes(status: SubscriptionStatus): Int =
    when (status) {
        SubscriptionStatus.Active -> R.string.account_subscription_status_active
        SubscriptionStatus.Trialing -> R.string.account_subscription_status_trialing
        SubscriptionStatus.PastDue -> R.string.account_subscription_status_past_due
        SubscriptionStatus.Suspended -> R.string.account_subscription_status_suspended
        SubscriptionStatus.Canceled -> R.string.account_subscription_status_canceled
        SubscriptionStatus.Unknown -> R.string.account_unknown
    }
