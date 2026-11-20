package space.ivlev.umbravpn.ui.screens.admin

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.orbitmvi.orbit.compose.collectAsState
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.admin.AdminMessage
import space.ivlev.umbravpn.domain.model.admin.AdminBrowserProfile
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationIntensity
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationProfile
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminSettingsNumberField
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.screens.account.components.AccountFormScaffold
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingButton
import space.ivlev.umbravpn.viewmodel.AdminSettingsViewModel

@Composable
fun AdminSettingsScreen(viewModel: AdminSettingsViewModel = koinViewModel()) {
    val state by viewModel.collectAsState()
    val navController = LocalNavController.current
    var showLeaveDialog by rememberSaveable { mutableStateOf(false) }

    if (state.accessDenied) {
        AdminAccessDeniedScreen()
        return
    }

    BackHandler(enabled = state.isDirty) { showLeaveDialog = true }

    if (showLeaveDialog) {
        InfoDialog(
            onDismiss = { showLeaveDialog = false },
            onAttest = {
                showLeaveDialog = false
                navController.pop()
            },
            title = stringResource(R.string.admin_settings_leave_title),
            body = { Text(stringResource(R.string.admin_settings_leave_body)) },
            confirmText = stringResource(R.string.admin_settings_discard),
            destructive = true,
        )
    }

    if (state.savedDraft == null) {
        if (state.error != null) {
            AccountFormScaffold(title = stringResource(R.string.admin_hub_settings)) {
                AdminErrorCard(state.error ?: AdminMessage.Unknown)
                AccountLoadingButton(
                    text = stringResource(R.string.admin_retry),
                    onClick = viewModel::retry,
                )
            }
        } else {
            LoadingPlaceholder()
        }
        return
    }

    AccountFormScaffold(
        title = stringResource(R.string.admin_hub_settings),
        subtitle = stringResource(R.string.admin_hub_settings_hint),
    ) {
        state.error?.let { AdminErrorCard(it) }
        if (state.isSaved && !state.isDirty) {
            AdminChip(text = stringResource(R.string.admin_settings_saved), emphasized = true)
        }

        AdminSectionTitle(stringResource(R.string.admin_settings_obfuscation))

        val profileOptions =
            AdminObfuscationProfile.entries.map { AdminOption(it.apiValue, adminProfileLabel(it)) }
        AdminSelectField(
            label = stringResource(R.string.admin_settings_profile),
            selected = profileOptions.firstOrNull { it.id == state.draft.profile.apiValue },
            options = profileOptions,
            enabled = !state.isSaving,
            allowNone = false,
            onSelect = { option ->
                option?.let { viewModel.onProfileChange(AdminObfuscationProfile.fromApi(it.id)) }
            },
        )

        val intensityOptions =
            AdminObfuscationIntensity.entries.map {
                AdminOption(it.apiValue, adminIntensityLabel(it))
            }
        AdminSelectField(
            label = stringResource(R.string.admin_settings_intensity),
            selected = intensityOptions.firstOrNull { it.id == state.draft.intensity.apiValue },
            options = intensityOptions,
            enabled = !state.isSaving,
            allowNone = false,
            onSelect = { option ->
                option?.let {
                    viewModel.onIntensityChange(AdminObfuscationIntensity.fromApi(it.id))
                }
            },
        )

        val browserOptions =
            AdminBrowserProfile.entries.map { AdminOption(it.apiValue, adminBrowserLabel(it)) }
        AdminSelectField(
            label = stringResource(R.string.admin_settings_browser),
            selected = browserOptions.firstOrNull { it.id == state.draft.browser.apiValue },
            options = browserOptions,
            enabled = !state.isSaving,
            allowNone = false,
            onSelect = { option ->
                option?.let { viewModel.onBrowserChange(AdminBrowserProfile.fromApi(it.id)) }
            },
        )

        AdminSettingsNumberField(
            label = stringResource(R.string.admin_settings_mtu),
            value = state.draft.mtu,
            error = state.mtuError,
            enabled = !state.isSaving,
            onValueChange = { viewModel.onNumberChange(AdminSettingsNumberField.Mtu, it) },
        )
        AdminSettingsRangeFields(
            label = stringResource(R.string.admin_settings_jc),
            low = state.draft.jcMin,
            high = state.draft.jcMax,
            error = state.jcError,
            enabled = !state.isSaving,
            onLowChange = { viewModel.onNumberChange(AdminSettingsNumberField.JcMin, it) },
            onHighChange = { viewModel.onNumberChange(AdminSettingsNumberField.JcMax, it) },
        )
        AdminSettingsRangeFields(
            label = stringResource(R.string.admin_settings_jmin),
            low = state.draft.jminMin,
            high = state.draft.jminMax,
            error = state.jminError,
            enabled = !state.isSaving,
            onLowChange = { viewModel.onNumberChange(AdminSettingsNumberField.JminMin, it) },
            onHighChange = { viewModel.onNumberChange(AdminSettingsNumberField.JminMax, it) },
        )
        AdminSettingsRangeFields(
            label = stringResource(R.string.admin_settings_jmax),
            low = state.draft.jmaxExtraMin,
            high = state.draft.jmaxExtraMax,
            error = state.jmaxError,
            enabled = !state.isSaving,
            onLowChange = { viewModel.onNumberChange(AdminSettingsNumberField.JmaxExtraMin, it) },
            onHighChange = { viewModel.onNumberChange(AdminSettingsNumberField.JmaxExtraMax, it) },
        )
        AdminSettingsRangeFields(
            label = stringResource(R.string.admin_settings_s),
            low = state.draft.sMin,
            high = state.draft.sMax,
            error = state.sError,
            enabled = !state.isSaving,
            onLowChange = { viewModel.onNumberChange(AdminSettingsNumberField.SMin, it) },
            onHighChange = { viewModel.onNumberChange(AdminSettingsNumberField.SMax, it) },
        )
        AdminField(
            value = state.draft.hosts,
            onValueChange = viewModel::onHostsChange,
            label = stringResource(R.string.admin_settings_hosts),
            error = state.hostsError,
            enabled = !state.isSaving,
            singleLine = false,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )

        AdminSettingsSwitch(
            label = stringResource(R.string.admin_settings_random_trailers),
            checked = state.draft.randomTrailers,
            enabled = !state.isSaving,
            onChange = viewModel::onRandomTrailersChange,
        )
        AdminSettingsSwitch(
            label = stringResource(R.string.admin_settings_disable_cookies),
            checked = state.draft.disableCookies,
            enabled = !state.isSaving,
            onChange = viewModel::onDisableCookiesChange,
        )
        AdminSettingsRangeFields(
            label = stringResource(R.string.admin_settings_keepalive),
            low = state.draft.keepaliveMin,
            high = state.draft.keepaliveMax,
            error = state.keepaliveError,
            enabled = !state.isSaving,
            onLowChange = { viewModel.onNumberChange(AdminSettingsNumberField.KeepaliveMin, it) },
            onHighChange = { viewModel.onNumberChange(AdminSettingsNumberField.KeepaliveMax, it) },
        )

        AdminSectionTitle(stringResource(R.string.admin_settings_general))

        AdminSettingsNumberField(
            label = stringResource(R.string.admin_settings_share_ttl),
            value = state.draft.shareTtl,
            error = state.shareTtlError,
            enabled = !state.isSaving,
            onValueChange = { viewModel.onNumberChange(AdminSettingsNumberField.ShareTtl, it) },
            hint = stringResource(R.string.admin_settings_share_ttl_hint),
        )
        AdminSettingsNumberField(
            label = stringResource(R.string.admin_settings_retention),
            value = state.draft.retentionDays,
            error = state.retentionError,
            enabled = !state.isSaving,
            onValueChange = {
                viewModel.onNumberChange(AdminSettingsNumberField.RetentionDays, it)
            },
            hint = stringResource(R.string.admin_settings_retention_hint),
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = viewModel::discard,
                enabled = state.isDirty && !state.isSaving,
                modifier = Modifier.weight(1f),
            ) {
                Text(stringResource(R.string.admin_settings_discard))
            }
            AccountLoadingButton(
                text = stringResource(R.string.admin_save),
                onClick = viewModel::save,
                loading = state.isSaving,
                enabled = state.canSave,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun AdminSectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun AdminSettingsNumberField(
    label: String,
    value: String,
    error: AdminMessage?,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    hint: String? = null,
) {
    AdminField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        error = error,
        enabled = enabled,
        modifier = modifier,
        keyboardOptions =
            KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
    )
    hint?.let {
        Text(
            text = it,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
    }
}

@Composable
private fun AdminSettingsRangeFields(
    label: String,
    low: String,
    high: String,
    error: AdminMessage?,
    enabled: Boolean,
    onLowChange: (String) -> Unit,
    onHighChange: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AdminSettingsNumberField(
            label = stringResource(R.string.admin_settings_min, label),
            value = low,
            error = error,
            enabled = enabled,
            onValueChange = onLowChange,
            modifier = Modifier.weight(1f),
        )
        AdminSettingsNumberField(
            label = stringResource(R.string.admin_settings_max, label),
            value = high,
            error = error,
            enabled = enabled,
            onValueChange = onHighChange,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun AdminSettingsSwitch(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

@Composable
private fun adminProfileLabel(profile: AdminObfuscationProfile): String =
    stringResource(
        when (profile) {
            AdminObfuscationProfile.Http3 -> R.string.admin_settings_profile_http3
            AdminObfuscationProfile.Tls -> R.string.admin_settings_profile_tls
            AdminObfuscationProfile.Quic -> R.string.admin_settings_profile_quic
            AdminObfuscationProfile.Random -> R.string.admin_settings_profile_random
        },
    )

@Composable
private fun adminIntensityLabel(intensity: AdminObfuscationIntensity): String =
    stringResource(
        when (intensity) {
            AdminObfuscationIntensity.Low -> R.string.admin_settings_intensity_low
            AdminObfuscationIntensity.Medium -> R.string.admin_settings_intensity_medium
            AdminObfuscationIntensity.High -> R.string.admin_settings_intensity_high
        },
    )

@Composable
private fun adminBrowserLabel(browser: AdminBrowserProfile): String =
    stringResource(
        when (browser) {
            AdminBrowserProfile.Chrome -> R.string.admin_settings_browser_chrome
            AdminBrowserProfile.Firefox -> R.string.admin_settings_browser_firefox
            AdminBrowserProfile.Safari -> R.string.admin_settings_browser_safari
            AdminBrowserProfile.Edge -> R.string.admin_settings_browser_edge
            AdminBrowserProfile.Random -> R.string.admin_settings_browser_random
        },
    )
