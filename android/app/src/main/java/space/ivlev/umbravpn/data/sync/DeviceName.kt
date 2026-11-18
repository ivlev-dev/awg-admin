package space.ivlev.umbravpn.data.sync

import android.os.Build

const val DEFAULT_DEVICE_NAME = "Umbra VPN"

private const val PLACEHOLDER_MODEL = "sdk"

fun defaultManagedDeviceName(): String {
    val model = runCatching { Build.MODEL }.getOrNull()?.trim().orEmpty()
    if (model.isEmpty() || model.equals(PLACEHOLDER_MODEL, ignoreCase = true)) {
        return DEFAULT_DEVICE_NAME
    }
    return model
}
