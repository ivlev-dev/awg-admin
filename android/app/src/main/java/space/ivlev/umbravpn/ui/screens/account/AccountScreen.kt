package space.ivlev.umbravpn.ui.screens.account

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import com.dokar.sonner.ToastType
import org.koin.compose.viewmodel.koinActivityViewModel
import org.orbitmvi.orbit.compose.collectAsState
import org.orbitmvi.orbit.compose.collectSideEffect
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.screens.account.components.AccountDialogs
import space.ivlev.umbravpn.ui.screens.account.components.AccountErrorContent
import space.ivlev.umbravpn.ui.screens.account.components.AccountLoadingContent
import space.ivlev.umbravpn.ui.screens.account.components.AccountProfileContent
import space.ivlev.umbravpn.ui.screens.account.components.AccountSignedOutContent
import space.ivlev.umbravpn.ui.screens.account.components.accountMessageRes
import space.ivlev.umbravpn.ui.state.AccountSideEffect
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.AccountViewModel
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun AccountScreen(
    viewModel: AccountViewModel = koinActivityViewModel(),
    sharedViewModel: SharedAppViewModel = koinActivityViewModel(),
) {
    val navController = LocalNavController.current
    val state by viewModel.collectAsState()

    viewModel.collectSideEffect { effect ->
        when (effect) {
            AccountSideEffect.SignedOut -> navController.resetTo(Route.Login)
            is AccountSideEffect.Notice ->
                sharedViewModel.showSnackMessage(
                    StringValue.StringResource(accountMessageRes(effect.message)),
                    if (effect.isError) ToastType.Error else ToastType.Success,
                )
        }
    }

    AccountDialogs(
        state = state,
        onDismiss = viewModel::dismissDialog,
        onCreateDevice = viewModel::createDevice,
        onRenameDevice = viewModel::renameDevice,
        onDeleteDevice = viewModel::deleteDevice,
        onAddTunnel = viewModel::addTunnel,
        onRenameTunnel = viewModel::renameTunnel,
        onDeleteTunnel = viewModel::deleteTunnel,
        onLogout = viewModel::logout,
        onChangeServer = viewModel::changeServer,
    )

    when {
        !state.isActive && state.snapshot == null && state.session !is SessionState.Unknown ->
            AccountSignedOutContent(state)
        state.snapshot == null && state.error == null -> AccountLoadingContent()
        state.snapshot == null && state.error != null ->
            AccountErrorContent(
                state = state,
                onRetry = viewModel::retry,
                onConfigureServer = { navController.push(Route.Onboarding) },
                onSignOut = viewModel::logout,
            )
        else -> AccountProfileContent(state = state, viewModel = viewModel)
    }
}
