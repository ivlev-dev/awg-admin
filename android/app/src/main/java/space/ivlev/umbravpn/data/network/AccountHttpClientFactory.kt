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

object AccountHttpClientFactory {
    val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
    }

    fun create(): HttpClient =
        HttpClient(OkHttp) {
            install(DefaultRequest) {
                headers {
                    append(HttpHeaders.UserAgent, "umbravpn/${BuildConfig.VERSION_NAME} (Android)")
                    append(HttpHeaders.Accept, "application/json")
                }
            }

            install(ContentNegotiation) { json(json) }

            install(HttpTimeout) {
                requestTimeoutMillis = 30_000L
                connectTimeoutMillis = 15_000L
                socketTimeoutMillis = 30_000L
            }
        }
}
