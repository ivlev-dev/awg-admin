package space.ivlev.umbravpn.ui.navigation.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import space.ivlev.umbravpn.ui.navigation.NavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.ui.state.GlobalAppUiState
import space.ivlev.umbravpn.ui.state.NavbarState
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

@Composable
fun currentRouteAsNavbarState(
    globalState: GlobalAppUiState,
    sharedViewModel: SharedAppViewModel,
    route: Route?,
    navController: NavController,
    screenDirty: Boolean = false,
): State<NavbarState> {
    val keyboardController = LocalSoftwareKeyboardController.current
    val resources = LocalResources.current

    return remember(route, globalState, screenDirty, resources) {
        derivedStateOf {
            val context =
                NavbarContext(
                    globalState = globalState,
                    sharedViewModel = sharedViewModel,
                    navController = navController,
                    keyboardController = keyboardController,
                    resources = resources,
                    screenDirty = screenDirty,
                )

            adminNavbarState(context, route)
                ?: settingsNavbarState(context, route)
                ?: tunnelsNavbarState(context, route)
                ?: accountSupportNavbarState(context, route)
                ?: NavbarState()
        }
    }
}
