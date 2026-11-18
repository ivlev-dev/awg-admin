package space.ivlev.umbravpn.ui.screens.settings.appearance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.common.button.SurfaceRow
import space.ivlev.umbravpn.ui.common.label.GroupLabel
import space.ivlev.umbravpn.ui.navigation.Route

@Composable
fun AppearanceScreen() {
    val navController = LocalNavController.current

    Column(
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.Top),
        modifier = Modifier.fillMaxSize(),
    ) {
        Column {
            GroupLabel(
                stringResource(R.string.display),
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            SurfaceRow(
                leading = { Icon(Icons.Outlined.Translate, contentDescription = null) },
                title = stringResource(R.string.language),
                onClick = { navController.push(Route.Language) },
            )
            SurfaceRow(
                leading = { Icon(Icons.Outlined.Contrast, contentDescription = null) },
                title = stringResource(R.string.display_theme),
                onClick = { navController.push(Route.Display) },
            )
            SurfaceRow(
                leading = { Icon(Icons.Outlined.Notifications, contentDescription = null) },
                title = stringResource(R.string.notifications),
                onClick = { navController.push(Route.Notifications) },
            )
        }
    }
}
