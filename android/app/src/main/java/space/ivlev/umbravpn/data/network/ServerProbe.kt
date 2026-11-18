package space.ivlev.umbravpn.data.network

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import space.ivlev.umbravpn.domain.account.ServerProbeResult

class ServerProbe(private val client: HttpClient) {
    suspend fun check(baseUrl: String): ServerProbeResult {
        val root = baseUrl.trim().trimEnd('/')
        if (root.isEmpty()) return ServerProbeResult.Unreachable

        val response: HttpResponse =
            try {
                client.get("$root/ready")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return ServerProbeResult.Unreachable
            }

        return if (response.status.isSuccess()) ServerProbeResult.Ready
        else ServerProbeResult.Unavailable
    }
}
