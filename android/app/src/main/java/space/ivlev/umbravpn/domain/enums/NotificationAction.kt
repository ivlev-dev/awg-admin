package space.ivlev.umbravpn.domain.enums

import android.content.Context
import space.ivlev.umbravpn.R

enum class NotificationAction {
    TUNNEL_OFF,
    STOP_ALL;

    fun title(context: Context): String {
        return when (this) {
            TUNNEL_OFF -> context.getString(R.string.stop)
            STOP_ALL -> context.getString(R.string.stop_all)
        }
    }
}
