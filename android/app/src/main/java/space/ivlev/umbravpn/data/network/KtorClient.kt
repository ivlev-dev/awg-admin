package space.ivlev.umbravpn.data.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import space.ivlev.umbravpn.BuildConfig

object KtorClient {
    fun create(): HttpClient {
        return HttpClient(OkHttp) {
            install(DefaultRequest) {
                headers {
                    append(HttpHeaders.UserAgent, "umbravpn/${BuildConfig.VERSION_NAME} (Android)")
                    append(HttpHeaders.Accept, "*/*")
                }
            }

            install(ContentNegotiation) {
                json(
                    Json {
                        ignoreUnknownKeys = true
                        isLenient = true
                    },
                )
            }

            install(HttpTimeout) {
                requestTimeoutMillis = 120_000L
                connectTimeoutMillis = 30_000L
                socketTimeoutMillis = 120_000L
            }
        }
    }
}
