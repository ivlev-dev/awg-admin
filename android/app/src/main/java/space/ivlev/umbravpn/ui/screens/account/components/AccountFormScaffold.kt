package space.ivlev.umbravpn.ui.screens.account.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.account.AccountMessage

@Composable
fun AccountFormScaffold(
    title: String,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AccountHeader(title = title, subtitle = subtitle)
        content()
    }
}

@Composable
fun AccountPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    visible: Boolean,
    modifier: Modifier = Modifier,
    error: AccountMessage? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    contentType: ContentType? = null,
    showToggle: Boolean = true,
    onToggleVisibility: (() -> Unit)? = null,
) {
    val toggle: (@Composable (Modifier) -> Unit)? =
        if (showToggle && onToggleVisibility != null) {
            { toggleModifier ->
                IconButton(onClick = onToggleVisibility, modifier = toggleModifier) {
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
            }
        } else {
            null
        }

    AccountFormField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        error = error,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        contentType = contentType,
        visualTransformation =
            if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailing = toggle,
    )
}

@Composable
fun ColumnScope.AccountBackToLoginButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(
        onClick = onClick,
        modifier = modifier.align(Alignment.CenterHorizontally),
    ) {
        Text(stringResource(R.string.account_back_to_login))
    }
}
