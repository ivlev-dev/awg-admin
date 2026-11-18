package space.ivlev.umbravpn.domain.sync

import space.ivlev.umbravpn.domain.repository.ManagedTunnelRepository
import space.ivlev.umbravpn.domain.repository.TunnelRepository

class ManagedTunnelCleaner(
    private val managedTunnelRepository: ManagedTunnelRepository,
    private val tunnelRepository: TunnelRepository,
) {
    suspend fun clear() {
        for (binding in managedTunnelRepository.getAll()) {
            tunnelRepository.getById(binding.tunnelId)?.let { tunnelRepository.delete(it) }
            managedTunnelRepository.unbind(binding.deviceId)
        }
    }
}
