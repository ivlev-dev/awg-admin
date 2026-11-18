package space.ivlev.umbravpn.ui.screens.pin

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.dokar.sonner.ToastType
import kotlinx.coroutines.delay
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinActivityViewModel
import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.core.lock.PinLockGuard
import space.ivlev.umbravpn.ui.LocalNavController
import space.ivlev.umbravpn.ui.navigation.Route
import space.ivlev.umbravpn.util.StringValue
import space.ivlev.umbravpn.viewmodel.SharedAppViewModel
import xyz.teamgravity.pin_lock_compose.PinLock
import xyz.teamgravity.pin_lock_compose.PinManager

@Composable
fun PinLockScreen(sharedViewModel: SharedAppViewModel = koinActivityViewModel()) {
    val navController = LocalNavController.current
    // Returns at once after the first call and must run before pinExists()
    PinManager.initialize(context = LocalContext.current)
    val guard: PinLockGuard = koinInject()
    val pinAlreadyExists by rememberSaveable { mutableStateOf(PinManager.pinExists()) }
    var pinCreated by rememberSaveable { mutableStateOf(false) }
    // Bumped on each wrong PIN to show the message again
    var incorrectAttempts by remember { mutableIntStateOf(0) }
    var showIncorrect by remember { mutableStateOf(false) }
    var attemptsLeft by remember { mutableIntStateOf(guard.attemptsLeft()) }
    var lockedSeconds by remember { mutableLongStateOf(guard.remainingSeconds()) }

    LaunchedEffect(lockedSeconds) {
        if (lockedSeconds <= 0) return@LaunchedEffect
        delay(LOCKOUT_TICK_MS)
        lockedSeconds = guard.remainingSeconds()
    }
    LaunchedEffect(incorrectAttempts) {
        if (incorrectAttempts == 0) return@LaunchedEffect
        showIncorrect = true
        delay(INCORRECT_MESSAGE_MS)
        showIncorrect = false
    }

    fun onPinCorrect() {
        guard.onSuccess()
        attemptsLeft = guard.attemptsLeft()
        sharedViewModel.authenticated()
        if (navController.currentRoute is Route.Lock) navController.popUpTo(Route.Tunnels)
    }

    // Wrong-PIN lockout hides the keypad entirely, so a correct guess cannot be entered either.
    if (lockedSeconds > 0) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(id = R.string.enter_pin),
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.titleLarge,
            )
            Text(
                text = stringResource(R.string.pin_locked_out, lockedSeconds),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
        return
    }

    PinLock(
        title = {
            Text(
                color =
                    if (showIncorrect) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurface,
                text =
                    when {
                        showIncorrect && attemptsLeft > 0 ->
                            stringResource(id = R.string.pin_attempts_left, attemptsLeft)
                        showIncorrect -> stringResource(id = R.string.incorrect_pin)
                        pinAlreadyExists -> stringResource(id = R.string.enter_pin)
                        else -> stringResource(id = R.string.create_pin)
                    },
                // Read out by screen readers, since a toast would sit beneath the lock
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        },
        onPinCorrect = { onPinCorrect() },
        onPinIncorrect = {
            guard.onFailure()
            attemptsLeft = guard.attemptsLeft()
            lockedSeconds = guard.remainingSeconds()
            incorrectAttempts++
        },
        onPinCreated = {
            pinCreated = true
            guard.onSuccess()
            sharedViewModel.showSnackMessage(
                StringValue.StringResource(R.string.pin_created),
                ToastType.Success,
            )
            // Unlock first so turning the lock on doesn't show the PIN screen again
            onPinCorrect()
            sharedViewModel.setPinLockEnabled(true)
        },
    )
    BackHandler(enabled = (!pinAlreadyExists && !pinCreated)) {
        PinManager.clearPin()
        navController.push(Route.Settings)
    }
}

private const val INCORRECT_MESSAGE_MS = 2_000L
private const val LOCKOUT_TICK_MS = 1_000L
