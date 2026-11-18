package space.ivlev.umbravpn.core.shortcut

interface ShortcutManager {
    suspend fun addShortcuts()

    suspend fun removeShortcuts()
}
