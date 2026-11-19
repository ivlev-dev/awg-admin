package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.time.Instant
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountFormat
import space.ivlev.umbravpn.domain.model.account.AccountQuota

@Composable
internal fun AccountQuotaCard(
    quota: AccountQuota,
    percent: Double?,
    throttled: Boolean,
    resetAt: Instant?,
) {
    AccountCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = stringResource(R.string.account_quota_title),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text =
                    AccountFormat.percent(percent)
                        ?: stringResource(R.string.account_quota_unlimited),
                style = MaterialTheme.typography.titleMedium,
                color =
                    if (throttled) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.primary,
            )
        }
        if (quota.quotaBytes != null) {
            LinearProgressIndicator(
                progress = { ((percent ?: 0.0) / 100.0).toFloat() },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                color =
                    if (throttled) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.primary,
            )
            Text(
                text = AccountFormat.quotaUsed(quota),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 8.dp),
            )
        } else {
            Text(
                text =
                    stringResource(
                        R.string.account_quota_used,
                        AccountFormat.bytes(quota.usedBytes),
                    ),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        if (throttled) {
            Text(
                text = stringResource(R.string.account_quota_exceeded),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        val resetLabel = AccountFormat.date(resetAt)
        if (resetLabel != null) {
            Text(
                text = stringResource(R.string.account_quota_resets, resetLabel),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
