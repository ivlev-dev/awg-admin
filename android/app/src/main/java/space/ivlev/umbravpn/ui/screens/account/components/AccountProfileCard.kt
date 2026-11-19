package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
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
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.UserRole

@Composable
internal fun AccountProfileCard(snapshot: AccountSnapshot) {
    val user = snapshot.user
    val node =
        snapshot.devices.firstOrNull { it.nodeName.isNotBlank() }?.nodeName
            ?: user.nodeId
            ?: stringResource(R.string.account_unknown)

    AccountCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    Icons.Outlined.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(12.dp),
                )
            }
            Column(
                modifier = Modifier.padding(start = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = user.email.ifBlank { user.login },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (user.login.isNotBlank() && user.login != user.email) {
                    Text(
                        text = user.login,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }
        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
        AccountInfoRow(
            label = stringResource(R.string.account_role),
            value = stringResource(roleRes(user.role)),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.account_status),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
            )
            AccountStatusChip(status = user.status, disabled = user.disabled)
        }
        AccountInfoRow(
            label = stringResource(R.string.account_tariff),
            value = snapshot.tariff?.name ?: stringResource(R.string.account_unknown),
        )
        AccountInfoRow(label = stringResource(R.string.account_node), value = node)
    }
}

@Composable
private fun roleRes(role: UserRole): Int =
    when (role) {
        UserRole.Admin -> R.string.account_role_admin
        UserRole.User -> R.string.account_role_user
        UserRole.Unknown -> R.string.account_unknown
    }
