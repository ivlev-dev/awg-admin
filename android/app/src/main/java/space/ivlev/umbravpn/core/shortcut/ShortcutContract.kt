package space.ivlev.umbravpn.core.shortcut

object ShortcutContract {

    const val EXTRA_SHORTCUT_TYPE = "space.ivlev.umbravpn.shortcut.TYPE"

    const val EXTRA_TUNNEL_NAME = "tunnelName"

    const val EXTRA_CLASS_NAME = "className"

    enum class ShortcutType(val value: String) {
        TUNNEL("tunnel"),
    }

    enum class Action {
        START,
        STOP,
    }

    object Legacy {

        const val TUNNEL_PROVIDER_NAME = "TunnelProvider"

        const val TUNNEL_SERVICE_NAME = "WireGuardTunnelService"
    }
}
