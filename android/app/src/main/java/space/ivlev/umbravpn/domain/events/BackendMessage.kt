package space.ivlev.umbravpn.domain.events

import space.ivlev.umbravpn.R
import space.ivlev.umbravpn.util.StringValue

sealed class BackendMessage {

    data object DynamicDnsSuccess : BackendMessage()

    fun toStringRes() =
        when (this) {
            DynamicDnsSuccess -> R.string.ddns_success_message
        }

    fun toStringValue() = StringValue.StringResource(this.toStringRes())
}
