package space.ivlev.umbravpn.service

import android.content.Context
import android.net.VpnService
import space.ivlev.umbravpn.util.permission.NotificationPermissionHelper

class ServiceManager(private val context: Context) {

    fun hasVpnPermission(): Boolean {
        return VpnService.prepare(context) == null
    }

    fun hasNotificationPermission(): Boolean {
        return NotificationPermissionHelper.isPermissionGranted(context)
    }
}
