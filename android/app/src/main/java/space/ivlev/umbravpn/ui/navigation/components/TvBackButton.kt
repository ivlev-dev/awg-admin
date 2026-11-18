package space.ivlev.umbravpn.ui.navigation.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.ui.LocalIsAndroidTV

@Composable
fun TvBackButton(onClick: () -> Unit) {
    val isTv = LocalIsAndroidTV.current

    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        if (isTv) {
            focusRequester.requestFocus()
        }
    }

    IconButton(onClick = onClick, modifier = Modifier.focusRequester(focusRequester)) {
        Icon(
            Icons.AutoMirrored.Rounded.ArrowBack,
            contentDescription = stringResource(R.string.back),
        )
    }
}
