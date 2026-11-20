package space.ivlev.umbravpn.domain.admin

import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.SessionState
import space.ivlev.umbravpn.domain.model.account.UserRole

fun AuthUser.isAdmin(): Boolean = role == UserRole.Admin

fun SessionState.isAdminSession(): Boolean = this is SessionState.Active && user.isAdmin()

fun SessionState.activeUserOrNull(): AuthUser? = (this as? SessionState.Active)?.user
