package space.ivlev.umbravpn.ui.navigation

import space.ivlev.umbravpn.domain.model.account.SessionState

fun resolveStartRedirect(serverUrl: String, session: SessionState): Route? =
    when {
        serverUrl.isBlank() -> Route.Onboarding
        session is SessionState.Active || session is SessionState.Unknown -> null
        else -> Route.Login
    }
