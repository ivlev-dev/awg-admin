package space.ivlev.umbravpn.data.mapper

import space.ivlev.umbravpn.data.entity.GeneralSettings as Entity
import space.ivlev.umbravpn.domain.model.GeneralSettings as Domain
import space.ivlev.umbravpn.ui.theme.Theme

fun Entity.toDomain(): Domain =
    Domain(
        id = id,
        isShortcutsEnabled = isShortcutsEnabled,
        isRestoreOnBootEnabled = isRestoreOnBootEnabled,
        isMultiTunnelEnabled = isMultiTunnelEnabled,
        isGlobalSplitTunnelEnabled = isGlobalSplitTunnelEnabled,
        tunnelMode = tunnelMode,
        theme = Theme.valueOf(theme.uppercase()),
        locale = locale,
        remoteKey = remoteKey,
        isRemoteControlEnabled = isRemoteControlEnabled,
        isPinLockEnabled = isPinLockEnabled,
        isAlwaysOnVpnEnabled = isAlwaysOnVpnEnabled,
        alreadyDonated = alreadyDonated,
        screenRecordingSecurityEnabled = screenRecordingSecurityEnabled,
        isGlobalAmneziaEnabled = isGlobalAmneziaEnabled,
        tunnelScriptingEnabled = tunnelScriptingEnabled,
        seamlessRecoveryEnabled = seamlessRecoveryEnabled,
        seamlessRecoveryBounceDelaySec = seamlessRecoveryBounceDelaySec,
        isLiveUpdatesEnabled = isLiveUpdatesEnabled,
        isNotificationOriginEnabled = isNotificationOriginEnabled,
        isNotificationTransferEnabled = isNotificationTransferEnabled,
        isNotificationRecoveryEnabled = isNotificationRecoveryEnabled,
        isNotificationFailureTintEnabled = isNotificationFailureTintEnabled,
        strictSplitTunnelEnabled = strictSplitTunnelEnabled,
    )

fun Domain.toEntity(): Entity =
    Entity(
        id = id,
        isShortcutsEnabled = isShortcutsEnabled,
        isRestoreOnBootEnabled = isRestoreOnBootEnabled,
        isMultiTunnelEnabled = isMultiTunnelEnabled,
        isGlobalSplitTunnelEnabled = isGlobalSplitTunnelEnabled,
        tunnelMode = tunnelMode,
        theme = theme.name,
        locale = locale,
        remoteKey = remoteKey,
        isRemoteControlEnabled = isRemoteControlEnabled,
        isPinLockEnabled = isPinLockEnabled,
        isAlwaysOnVpnEnabled = isAlwaysOnVpnEnabled,
        alreadyDonated = alreadyDonated,
        screenRecordingSecurityEnabled = screenRecordingSecurityEnabled,
        isGlobalAmneziaEnabled = isGlobalAmneziaEnabled,
        tunnelScriptingEnabled = tunnelScriptingEnabled,
        seamlessRecoveryEnabled = seamlessRecoveryEnabled,
        seamlessRecoveryBounceDelaySec = seamlessRecoveryBounceDelaySec,
        isLiveUpdatesEnabled = isLiveUpdatesEnabled,
        isNotificationOriginEnabled = isNotificationOriginEnabled,
        isNotificationTransferEnabled = isNotificationTransferEnabled,
        isNotificationRecoveryEnabled = isNotificationRecoveryEnabled,
        isNotificationFailureTintEnabled = isNotificationFailureTintEnabled,
        strictSplitTunnelEnabled = strictSplitTunnelEnabled,
    )
