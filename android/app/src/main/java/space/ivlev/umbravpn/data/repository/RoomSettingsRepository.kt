package space.ivlev.umbravpn.data.repository

import kotlinx.coroutines.flow.map
import space.ivlev.umbravpn.data.dao.GeneralSettingsDao
import space.ivlev.umbravpn.data.entity.GeneralSettings as Entity
import space.ivlev.umbravpn.data.mapper.toDomain
import space.ivlev.umbravpn.data.mapper.toEntity
import space.ivlev.umbravpn.domain.enums.TunnelMode
import space.ivlev.umbravpn.domain.model.GeneralSettings as Domain
import space.ivlev.umbravpn.domain.repository.GeneralSettingRepository
import space.ivlev.umbravpn.ui.theme.Theme

class RoomSettingsRepository(private val settingsDao: GeneralSettingsDao) :
    GeneralSettingRepository {
    override suspend fun upsert(generalSettings: Domain) {
        settingsDao.upsert(generalSettings.toEntity())
    }

    override val flow = settingsDao.getGeneralSettingsFlow().map { (it ?: Entity()).toDomain() }

    override suspend fun getGeneralSettings(): Domain {
        return (settingsDao.getGeneralSettings() ?: Entity()).toDomain()
    }

    override suspend fun updateTheme(theme: Theme) {
        settingsDao.updateTheme(theme.name)
    }

    override suspend fun updateLocale(locale: String) {
        settingsDao.updateLocale(locale)
    }

    override suspend fun updatePinLockEnabled(enabled: Boolean) {
        settingsDao.updatePinLockEnabled(enabled)
    }

    override suspend fun updateAppMode(tunnelMode: TunnelMode) {
        settingsDao.updateAppMode(tunnelMode)
    }

    override suspend fun updateGlobalAmneziaEnabled(enabled: Boolean) {
        settingsDao.updateGlobalAmneziaEnabled(enabled)
    }

    override suspend fun updateScreenRecordingSecurity(enabled: Boolean) {
        settingsDao.updateScreenRecordingSecurity(enabled)
    }

    override suspend fun updateSeamlessRecovery(enabled: Boolean) {
        settingsDao.updateSeamlessRecovery(enabled)
    }

    override suspend fun updateSeamlessRecoveryBounceDelay(seconds: Int) {
        settingsDao.updateSeamlessRecoveryBounceDelay(seconds)
    }
}
