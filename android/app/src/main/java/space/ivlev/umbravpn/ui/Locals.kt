package space.ivlev.umbravpn.ui

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import space.ivlev.umbravpn.ui.navigation.NavController

val LocalIsAndroidTV = staticCompositionLocalOf { false }

val LocalNavController = staticCompositionLocalOf<NavController> { error("No backstack provided") }

typealias BackStack = NavBackStack<NavKey>
