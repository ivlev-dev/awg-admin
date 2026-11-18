package space.ivlev.umbravpn.ui.state

import androidx.compose.runtime.Composable

data class NavbarState(
    val topTitle: String? = null,
    val topTrailing: (@Composable () -> Unit)? = null,
    val topLeading: (@Composable () -> Unit)? = null,
    val showBottomItems: Boolean = false,
    val topActionEnabled: Boolean = true,
)
