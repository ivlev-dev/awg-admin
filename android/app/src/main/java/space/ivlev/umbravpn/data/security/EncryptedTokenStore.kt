package space.ivlev.umbravpn.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import space.ivlev.umbravpn.domain.model.account.StoredSession
import space.ivlev.umbravpn.domain.security.TokenStore
import timber.log.Timber

@Suppress("DEPRECATION")
class EncryptedTokenStore(private val context: Context) : TokenStore {
    private val preferences: SharedPreferences? by lazy { createPreferences() }

    override fun load(): StoredSession? = runCatching {
        readSession()
    }
        .onFailure { Timber.e(it, "failed to read account session") }
        .getOrNull()

    override fun save(session: StoredSession) {
        val prefs = preferences ?: return
        runCatching {
            prefs
                .edit()
                .putString(KEY_ACCESS_TOKEN, session.accessToken)
                .putString(KEY_REFRESH_TOKEN, session.refreshToken)
                .putLong(KEY_EXPIRES_AT, session.expiresAtEpochSeconds)
                .putString(KEY_USER_ID, session.userId)
                .putString(KEY_EMAIL, session.email)
                .apply()
        }
            .onFailure { Timber.e(it, "failed to persist account session") }
    }

    override fun clear() {
        val prefs = preferences ?: return
        runCatching { prefs.edit().clear().apply() }
            .onFailure { Timber.e(it, "failed to clear account session") }
    }

    private fun readSession(): StoredSession? {
        val prefs = preferences ?: return null
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null)?.takeIf { it.isNotBlank() }
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)?.takeIf { it.isNotBlank() }
        if (accessToken == null || refreshToken == null) return null
        return StoredSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAtEpochSeconds = prefs.getLong(KEY_EXPIRES_AT, 0L),
            userId = prefs.getString(KEY_USER_ID, null),
            email = prefs.getString(KEY_EMAIL, null),
        )
    }

    private fun createPreferences(): SharedPreferences? = runCatching {
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
        .onFailure { Timber.e(it, "failed to open encrypted preferences") }
        .getOrNull()

    private companion object {
        const val FILE_NAME = "umbra_account_session"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_EXPIRES_AT = "expires_at"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMAIL = "email"
    }
}
