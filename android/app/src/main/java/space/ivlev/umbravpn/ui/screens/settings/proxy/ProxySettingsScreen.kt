package space.ivlev.umbravpn.ui.screens.settings.proxy

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Forward
import androidx.compose.material.icons.outlined.Forward5
import androidx.compose.material.icons.outlined.Http
import androidx.compose.material.icons.outlined.RemoveRedEye
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.domain.model.ProxySettings
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.LoadingPlaceholder
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.button.ThemedSwitch
import space.ivlev.umbravpn.ui.common.dialog.InfoDialog
import space.ivlev.umbravpn.ui.common.dialog.rememberRestartToApplyChanges
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.common.text.DescriptionText
import space.ivlev.umbravpn.ui.common.textbox.ConfigurationTextBox
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.viewmodel.ProxySettingsViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun ProxySettingsScreen(
    viewModel: ProxySettingsViewModel = koinViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val uiState by viewModel.collectAsState()
    var showDiscardDialog by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(uiState.isDirty) { sharedViewModel.setScreenDirty(uiState.isDirty) }
    DisposableEffect(Unit) { onDispose { sharedViewModel.setScreenDirty(false) } }

    if (uiState.isLoading) {
        LoadingPlaceholder()
        return
    }

    val keyboardController = LocalSoftwareKeyboardController.current

    val keyboardActions = KeyboardActions(onDone = { keyboardController?.hide() })
    val keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done)

    val requestApply =
        rememberRestartToApplyChanges(
            needsRestart = uiState.backendStatus.activeTunnels.isNotEmpty(),
            onSave = viewModel::save,
        )

    sharedViewModel.collectSideEffect { sideEffect ->
        when (sideEffect) {
            is LocalSideEffect.SaveChanges -> requestApply()
            is LocalSideEffect.RequestBack ->
                if (uiState.isDirty) showDiscardDialog = true else navController.pop()
            else -> Unit
        }
    }

    BackHandler(enabled = uiState.isDirty) { showDiscardDialog = true }

    if (showDiscardDialog) {
        InfoDialog(
            onDismiss = { showDiscardDialog = false },
            onAttest = {
                showDiscardDialog = false
                navController.pop()
            },
            title = stringResource(R.string.discard_changes_title),
            body = { Text(stringResource(R.string.discard_changes_body)) },
            confirmText = stringResource(R.string.discard_changes_confirm),
            destructive = true,
        )
    }

    Column(
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Top),
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
    ) {
        Column {
            GroupLabel(stringResource(R.string.socks5), Modifier.padding(horizontal = 16.dp))
            SurfaceRow(
                leading = { Icon(Icons.Outlined.Forward5, contentDescription = null) },
                title = stringResource(R.string.socks_5_proxy),
                trailing = {
                    ThemedSwitch(
                        checked = uiState.socks5Enabled,
                        onClick = { viewModel.onSocks5EnabledChanged(it) },
                    )
                },
                onClick = { viewModel.onSocks5EnabledChanged(!uiState.socks5Enabled) },
            )
            if (uiState.socks5Enabled) {
                ConfigurationTextBox(
                    modifier =
                        Modifier.padding(horizontal = 16.dp).padding(top = 8.dp).fillMaxWidth(),
                    hint =
                        stringResource(
                            R.string.defaults_to_template,
                            ProxySettings.DEFAULT_SOCKS_BIND_ADDRESS,
                        ),
                    label = stringResource(R.string.socks_5_bind_address),
                    value = uiState.socksBindAddress,
                    isError = uiState.isSocks5BindAddressError,
                    onValueChange = {
                        if (uiState.isSocks5BindAddressError) viewModel.clearSocks5BindError()
                        viewModel.onSocksBindChanged(it)
                    },
                )
                if (uiState.proxyUsername.isBlank()) {
                    SurfaceRow(
                        leading = {
                            Icon(Icons.AutoMirrored.Outlined.Forward, contentDescription = null)
                        },
                        title = stringResource(R.string.allow_socks4),
                        description = {
                            DescriptionText(stringResource(R.string.allow_socks4_desc))
                        },
                        trailing = {
                            ThemedSwitch(
                                checked = uiState.allowSocks4,
                                onClick = { viewModel.onAllowSocks4Changed(it) },
                            )
                        },
                        onClick = { viewModel.onAllowSocks4Changed(!uiState.allowSocks4) },
                    )
                }
            }
        }
        Column {
            GroupLabel(stringResource(R.string.http), Modifier.padding(horizontal = 16.dp))
            SurfaceRow(
                leading = { Icon(Icons.Outlined.Http, contentDescription = null) },
                title = stringResource(R.string.http_proxy),
                trailing = {
                    ThemedSwitch(
                        checked = uiState.httpEnabled,
                        onClick = { viewModel.onHttpEnabledChanged(it) },
                    )
                },
                onClick = { viewModel.onHttpEnabledChanged(!uiState.httpEnabled) },
            )
            if (uiState.httpEnabled) {
                ConfigurationTextBox(
                    modifier =
                        Modifier.padding(horizontal = 16.dp).padding(top = 8.dp).fillMaxWidth(),
                    hint =
                        stringResource(
                            R.string.defaults_to_template,
                            ProxySettings.DEFAULT_HTTP_BIND_ADDRESS,
                        ),
                    label = stringResource(R.string.http_bind_address),
                    value = uiState.httpBindAddress,
                    isError = uiState.isHttpBindAddressError,
                    onValueChange = {
                        if (uiState.isHttpBindAddressError) viewModel.clearHttpBindError()
                        viewModel.onHttpBindChanged(it)
                    },
                )
            }
        }
        if (uiState.socks5Enabled || uiState.httpEnabled) {
            Column(
                horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.Top),
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                GroupLabel(
                    stringResource(
                        R.string.recommended_template,
                        stringResource((R.string.proxy_credentials)),
                    ),
                )
                ConfigurationTextBox(
                    value = uiState.proxyUsername,
                    onValueChange = {
                        if (uiState.isUserNameError) viewModel.clearUsernameError()
                        viewModel.onUsernameChanged(it)
                    },
                    label = stringResource(R.string.username),
                    isError = uiState.isUserNameError,
                    hint = "",
                    keyboardActions = keyboardActions,
                    keyboardOptions = keyboardOptions,
                )
                ConfigurationTextBox(
                    value = uiState.proxyPassword,
                    onValueChange = {
                        if (uiState.isPasswordError) viewModel.clearPasswordError()
                        viewModel.onPasswordChanged(it)
                    },
                    label = stringResource(R.string.password),
                    isError = uiState.isPasswordError,
                    hint = "",
                    keyboardActions = keyboardActions,
                    keyboardOptions = keyboardOptions,
                    trailing = {
                        IconButton(
                            onClick = {
                                viewModel.onPasswordVisibilityChanged(!uiState.passwordVisible)
                            },
                        ) {
                            Icon(
                                Icons.Outlined.RemoveRedEye,
                                stringResource(R.string.show_password),
                            )
                        }
                    },
                    visualTransformation =
                        if (!uiState.passwordVisible) PasswordVisualTransformation()
                        else VisualTransformation.None,
                )
            }
        }
    }
}
