package space.ivlev.umbravpn.data.admin

import space.ivlev.umbravpn.data.account.UserDto
import space.ivlev.umbravpn.data.account.toInstantOrNull
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus
import space.ivlev.umbravpn.domain.model.admin.AdminAuditEntry
import space.ivlev.umbravpn.domain.model.admin.AdminAuditPage
import space.ivlev.umbravpn.domain.model.admin.AdminBrowserProfile
import space.ivlev.umbravpn.domain.model.admin.AdminGroup
import space.ivlev.umbravpn.domain.model.admin.AdminInterface
import space.ivlev.umbravpn.domain.model.admin.AdminNode
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscation
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationIntensity
import space.ivlev.umbravpn.domain.model.admin.AdminObfuscationProfile
import space.ivlev.umbravpn.domain.model.admin.AdminOption
import space.ivlev.umbravpn.domain.model.admin.AdminOverview
import space.ivlev.umbravpn.domain.model.admin.AdminPanelSettings
import space.ivlev.umbravpn.domain.model.admin.AdminPool
import space.ivlev.umbravpn.domain.model.admin.AdminPoolMode
import space.ivlev.umbravpn.domain.model.admin.AdminQuotaUser
import space.ivlev.umbravpn.domain.model.admin.AdminTariff
import space.ivlev.umbravpn.domain.model.admin.AdminTopDevice
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficPoint
import space.ivlev.umbravpn.domain.model.admin.AdminTrafficTotals
import space.ivlev.umbravpn.domain.model.admin.AdminUser

internal fun UserDto.toAdminUser(): AdminUser =
    AdminUser(
        id = id,
        email = email,
        fullName = fullName?.trim()?.takeIf { it.isNotEmpty() },
        status = UserStatus.fromApi(status),
        role = UserRole.fromApi(role),
        tariffId = tariffId,
        nodeId = nodeId,
        groupId = groupId,
        disabled = disabled,
        createdAt = createdAt.toInstantOrNull(),
    )

internal fun AdminTariffDto.toDomain(): AdminTariff =
    AdminTariff(
        id = id,
        name = name,
        description = description,
        maxDevices = maxDevices,
        deviceDownKbps = deviceDownKbps,
        deviceUpKbps = deviceUpKbps,
        trafficQuotaBytes = trafficQuotaBytes,
        interfaceId = interfaceId,
        interfaceName = interfaceName,
    )

internal fun AdminOverviewDto.toDomain(): AdminOverview =
    AdminOverview(
        users = users,
        devices = devices,
        nodesOnline = nodesOnline,
        nodesTotal = nodesTotal,
        interfaces = interfaces,
        groups = groups,
        today = today.toDomain(),
        month = month.toDomain(),
        rxBps = rxBps,
        txBps = txBps,
        topDevices = topDevices.map(AdminTopDeviceDto::toDomain),
    )

internal fun AdminTrafficTotalsDto.toDomain(): AdminTrafficTotals =
    AdminTrafficTotals(rx = rx, tx = tx)

internal fun AdminTopDeviceDto.toDomain(): AdminTopDevice =
    AdminTopDevice(
        deviceId = deviceId,
        name = name.ifBlank { deviceId },
        userId = userId,
        rx = rx,
        tx = tx,
        online = online,
    )

internal fun AdminAuditEntryDto.toDomain(): AdminAuditEntry =
    AdminAuditEntry(
        id = id,
        at = at.toInstantOrNull(),
        actorId = actorId,
        actorEmail = actorEmail.ifBlank { actorLogin },
        actorLogin = actorLogin,
        action = action,
        entity = entity,
        entityId = entityId,
        status = status,
        ip = ip,
        details = details,
    )

internal fun AdminAuditPageDto.toDomain(): AdminAuditPage =
    AdminAuditPage(items = items.map(AdminAuditEntryDto::toDomain), nextCursor = nextCursor)

internal fun AdminSeriesPointDto.toDomain(): AdminTrafficPoint =
    AdminTrafficPoint(at = at.toInstantOrNull(), rx = rx, tx = tx)

internal fun AdminStatsPointDto.toDomain(): AdminTrafficPoint =
    AdminTrafficPoint(at = at.toInstantOrNull(), rx = rx, tx = tx)

internal fun AdminQuotaUserDto.toDomain(): AdminQuotaUser =
    AdminQuotaUser(
        userId = userId,
        email = email,
        usedBytes = usedBytes,
        quotaBytes = quotaBytes,
        exceeded = exceeded,
        percent = percent,
    )

internal fun AdminObfuscationDto.toDomain(): AdminObfuscation =
    AdminObfuscation(
        profile = AdminObfuscationProfile.fromApi(profile),
        intensity = AdminObfuscationIntensity.fromApi(intensity),
        browser = AdminBrowserProfile.fromApi(browser),
        mtu = mtu,
        jcMin = jcMin,
        jcMax = jcMax,
        jminMin = jminMin,
        jminMax = jminMax,
        jmaxExtraMin = jmaxExtraMin,
        jmaxExtraMax = jmaxExtraMax,
        sMin = sMin,
        sMax = sMax,
        hosts = hosts,
        randomTrailers = randomTrailers,
        disableCookies = disableCookies,
        keepaliveMin = keepaliveMin,
        keepaliveMax = keepaliveMax,
    )

internal fun AdminSettingsDto.toDomain(): AdminPanelSettings =
    AdminPanelSettings(
        obfuscation = obfuscation.toDomain(),
        shareDefaultTtlSecs = shareDefaultTtlSecs,
        statsRetentionDays = statsRetentionDays,
    )

internal fun AdminGroupDto.toOption(): AdminOption =
    AdminOption(id = id, label = name.ifBlank { id })

internal fun AdminInterfaceOptionDto.toOption(): AdminOption =
    AdminOption(
        id = id,
        label = if (nodeName.isBlank()) name.ifBlank { id } else "$name · $nodeName",
    )

internal fun AdminNodeDto.toDomain(): AdminNode =
    AdminNode(
        id = id,
        name = name.ifBlank { id },
        online = online,
        lastSeen = lastSeen.toInstantOrNull(),
        version = version?.takeIf { it.isNotBlank() },
        interfaces = interfaces,
        tokenIssuedAt = tokenIssuedAt.toInstantOrNull(),
        cpuLoad = cpuLoad,
        memUsedBytes = memUsedBytes,
        memTotalBytes = memTotalBytes,
        kernelVersion = kernelVersion?.takeIf { it.isNotBlank() },
        workerVersion = workerVersion?.takeIf { it.isNotBlank() },
        uptimeSecs = uptimeSecs,
    )

internal fun AdminInterfaceDto.toDomain(): AdminInterface =
    AdminInterface(
        id = id,
        groupId = groupId,
        groupName = groupName,
        nodeId = nodeId,
        nodeName = nodeName,
        name = name,
        label = label,
        endpointHost = endpointHost,
        endpointPort = endpointPort,
        listenPort = listenPort,
        mtu = mtu,
        publicKey = publicKey,
        enabled = enabled,
        peers = peers,
    )

internal fun AdminGroupViewDto.toDomain(): AdminGroup =
    AdminGroup(
        id = id,
        name = name.ifBlank { id },
        description = description,
        baseCidr = baseCidr,
        forwardingDefault = forwardingDefault,
        interfaces = interfaces,
        devices = devices,
    )

internal fun AdminPoolDto.toDomain(): AdminPool =
    AdminPool(
        id = id,
        groupId = groupId,
        name = name.ifBlank { id },
        cidr = cidr,
        mode = AdminPoolMode.fromApi(mode),
        gateway = gateway?.takeIf { it.isNotBlank() },
        enabled = enabled,
    )

internal val UserRole.apiValue: String
    get() =
        when (this) {
            UserRole.Admin -> "admin"
            UserRole.User,
            UserRole.Unknown -> "user"
        }
