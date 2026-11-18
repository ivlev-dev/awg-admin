package space.ivlev.umbravpn.domain.state

data class LogHealthState(val isHealthy: Boolean, val timestamp: Long = System.currentTimeMillis())
