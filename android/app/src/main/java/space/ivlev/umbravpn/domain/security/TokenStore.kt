package space.ivlev.umbravpn.domain.security

import space.ivlev.umbravpn.domain.model.account.StoredSession

interface TokenStore {
    fun load(): StoredSession?

    fun save(session: StoredSession)

    fun clear()
}
