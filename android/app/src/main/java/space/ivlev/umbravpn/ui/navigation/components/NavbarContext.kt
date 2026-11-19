package space.ivlev.umbravpn.ui.navigation.components

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.navigation.NavController
import space.ivlev.umbravpn.ui.sideeffect.LocalSideEffect
import space.ivlev.umbravpn.ui.state.GlobalAppUiState
import space.ivlev.umbravpn.ui.state.NavbarState
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel

internal class NavbarContext(
    val globalState: GlobalAppUiState,
    val sharedViewModel: SharedAppViewModel,
    val navController: NavController,
    val keyboardController: SoftwareKeyboardController?,
    val resources: Resources,
    val screenDirty: Boolean,
) {
    fun title(@StringRes id: Int): String = resources.getString(id)

    fun title(@StringRes id: Int, vararg args: Any): String = resources.getString(id, *args)

    fun popBack() = navController.pop()

    fun requestBack() {
        sharedViewModel.postSideEffect(LocalSideEffect.RequestBack)
    }

    fun postSideEffect(effect: LocalSideEffect) {
        sharedViewModel.postSideEffect(effect)
    }

    fun saveChanges() {
        keyboardController?.hide()
        sharedViewModel.postSideEffect(LocalSideEffect.SaveChanges)
    }
}

internal fun NavbarContext.popBackLeading(): @Composable () -> Unit = { TvBackButton { popBack() } }

internal fun NavbarContext.requestBackLeading(): @Composable () -> Unit = {
    TvBackButton { requestBack() }
}

internal fun NavbarContext.saveTrailing(enabled: Boolean = screenDirty): @Composable () -> Unit = {
    IconButton(enabled = enabled, onClick = { saveChanges() }) {
        Icon(Icons.Rounded.Save, stringResource(R.string.save))
    }
}

internal fun NavbarContext.backTitleState(
    @StringRes titleRes: Int,
    showBottomItems: Boolean = true,
): NavbarState =
    NavbarState(
        topLeading = popBackLeading(),
        showBottomItems = showBottomItems,
        topTitle = title(titleRes),
    )
