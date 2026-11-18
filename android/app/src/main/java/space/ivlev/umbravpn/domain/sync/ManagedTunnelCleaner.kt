package space.ivlev.umbravpn.domain.sync

import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository

interface ManagedTunnelCleanup {
    suspend fun clear()
}

class ManagedTunnelCleaner(
    private val managedTunnelRepository: ManagedTunnelRepository,
    private val tunnelRepository: TunnelRepository,
) : ManagedTunnelCleanup {
    override suspend fun clear() {
        for (binding in managedTunnelRepository.getAll()) {
            tunnelRepository.getById(binding.tunnelId)?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId, binding.interfaceId, binding.peerId)
        }
    }
}
