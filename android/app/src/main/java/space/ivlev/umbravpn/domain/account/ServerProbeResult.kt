package space.ivlev.umbravpn.domain.account

sealed interface ServerProbeResult {
    data object Ready : ServerProbeResult

    data object Unavailable : ServerProbeResult

    data object Unreachable : ServerProbeResult
}
