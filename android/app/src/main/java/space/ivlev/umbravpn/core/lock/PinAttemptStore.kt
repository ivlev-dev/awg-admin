package space.ivlev.umbravpn.core.lock

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import timber.log.Timber

interface PinAttemptStore {
    fun load(): PinAttemptState

    fun save(state: PinAttemptState)
}

/** Persists the failed PIN counter in encrypted preferences so it survives process restarts. */
@Suppress("DEPRECATION")
class EncryptedPinAttemptStore(private val context: Context) : PinAttemptStore {
    private val preferences by lazy {
        runCatching {
            val masterKey =
                MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
            .onFailure { Timber.e(it, "failed to open pin attempt storage") }
            .getOrNull()
    }

    override fun load(): PinAttemptState {
        val prefs = preferences ?: return PinAttemptState()
        return runCatching {
                PinAttemptState(
                    failures = prefs.getInt(KEY_FAILURES, 0),
                    lockedUntilEpochMs = prefs.getLong(KEY_LOCKED_UNTIL, 0L),
                )
            }
            .onFailure { Timber.e(it, "failed to read pin attempts") }
            .getOrDefault(PinAttemptState())
    }

    override fun save(state: PinAttemptState) {
        val prefs = preferences ?: return
        runCatching {
            prefs
                .edit()
                .putInt(KEY_FAILURES, state.failures)
                .putLong(KEY_LOCKED_UNTIL, state.lockedUntilEpochMs)
                .apply()
        }
            .onFailure { Timber.e(it, "failed to save pin attempts") }
    }

    private companion object {
        const val FILE_NAME = "umbra_pin_attempts"
        const val KEY_FAILURES = "failures"
        const val KEY_LOCKED_UNTIL = "locked_until"
    }
}
