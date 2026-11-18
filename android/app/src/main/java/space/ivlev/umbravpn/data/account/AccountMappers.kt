package space.ivlev.umbravpn.data.account

import java.time.Instant
import space.ivlev.umbravpn.domain.model.account.AccountAccess
import space.ivlev.umbravpn.domain.model.account.AccountAccessReason
import space.ivlev.umbravpn.domain.model.account.AccountDevice
import space.ivlev.umbravpn.domain.model.account.AccountInterface
import space.ivlev.umbravpn.domain.model.account.AccountQuota
import space.ivlev.umbravpn.domain.model.account.AccountSnapshot
import space.ivlev.umbravpn.domain.model.account.AccountSubscription
import space.ivlev.umbravpn.domain.model.account.AccountTariff
import space.ivlev.umbravpn.domain.model.account.AuthUser
import space.ivlev.umbravpn.domain.model.account.CreatedDevice
import space.ivlev.umbravpn.domain.model.account.DeviceConfig
import space.ivlev.umbravpn.domain.model.account.DevicePeer
import space.ivlev.umbravpn.domain.model.account.SubscriptionStatus
import space.ivlev.umbravpn.domain.model.account.UserRole
import space.ivlev.umbravpn.domain.model.account.UserStatus

internal fun UserDto.toDomain(): AuthUser =
    AuthUser(
        id = id,
        login = login,
        email = email,
        status = UserStatus.fromApi(status),
        totpEnabled = totpEnabled,
        role = UserRole.fromApi(role),
        tariffId = tariffId,
        groupId = groupId,
        nodeId = nodeId,
        disabled = disabled,
        createdAt = createdAt.toInstantOrNull(),
        updatedAt = updatedAt.toInstantOrNull(),
    )

internal fun TariffDto.toDomain(): AccountTariff =
    AccountTariff(
        id = id,
        name = name,
        description = description,
        maxDevices = maxDevices,
        deviceDownKbps = deviceDownKbps,
        deviceUpKbps = deviceUpKbps,
        trafficQuotaBytes = trafficQuotaBytes,
    )

internal fun QuotaDto.toDomain(): AccountQuota =
    AccountQuota(
        usedBytes = usedBytes,
        quotaBytes = quotaBytes,
        exceeded = exceeded,
        remainingBytes = remainingBytes,
        percent = percent,
        periodStart = periodStart.toInstantOrNull(),
        periodEnd = periodEnd.toInstantOrNull(),
        resetAt = resetAt.toInstantOrNull(),
    )

internal fun emptyQuota(): AccountQuota =
    AccountQuota(
        usedBytes = 0,
        quotaBytes = null,
        exceeded = false,
        remainingBytes = null,
        percent = null,
        periodStart = null,
        periodEnd = null,
        resetAt = null,
    )

internal fun DeviceDto.toDomain(): AccountDevice =
    AccountDevice(
        id = id,
        userId = userId,
        groupId = groupId,
        interfaceId = interfaceId,
        interfaceName = interfaceName,
        nodeId = nodeId,
        nodeName = nodeName,
        name = name,
        downKbps = downKbps,
        upKbps = upKbps,
        revoked = revoked,
        external = external,
        addresses = addresses,
        peers = peers.map(DevicePeerDto::toDomain),
        createdAt = createdAt.toInstantOrNull(),
    )

internal fun DevicePeerDto.toDomain(): DevicePeer =
    DevicePeer(
        interfaceId = interfaceId,
        interfaceName = interfaceName,
        publicKey = publicKey,
        addresses = addresses,
    )

internal fun DeviceConfigDto.toDomain(): DeviceConfig =
    DeviceConfig(
        interfaceId = interfaceId,
        interfaceName = interfaceName,
        nodeId = nodeId,
        endpoint = endpoint,
        addresses = addresses,
        conf = conf,
        revision = revision,
    )

internal fun BootstrapDto.toDomain(): AccountSnapshot =
    AccountSnapshot(
        user = user.toDomain(),
        tariff = tariff?.toDomain(),
        quota = quota?.toDomain() ?: emptyQuota(),
        devices = devices.map(DeviceDto::toDomain),
        interfaces = interfaces.map(InterfaceDto::toDomain),
        subscription = subscription?.toDomain(),
        access = access?.toDomain() ?: AccountAccess(),
    )

internal fun InterfaceDto.toDomain(): AccountInterface =
    AccountInterface(id = id, name = name, nodeId = nodeId, nodeName = nodeName)

internal fun SubscriptionDto.toDomain(): AccountSubscription =
    AccountSubscription(
        id = id,
        planName = planName,
        status = SubscriptionStatus.fromApi(status),
        currentPeriodEnd = currentPeriodEnd.toInstantOrNull(),
        autoRenew = autoRenew,
        cancelAtPeriodEnd = cancelAtPeriodEnd,
        grantsAccess = grantsAccess,
    )

internal fun AccessDto.toDomain(): AccountAccess =
    AccountAccess(
        blocked = blocked,
        throttled = throttled,
        reasons = reasons.map(AccountAccessReason::fromApi).toSet(),
    )

internal fun AppDeviceDto.toDomain(): CreatedDevice =
    CreatedDevice(
        device = device.toDomain(),
        config = config.toDomain(),
        configs = configs.ifEmpty { listOf(config) }.map(DeviceConfigDto::toDomain),
    )

internal fun String?.toInstantOrNull(): Instant? =
    this?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { value -> runCatching { Instant.parse(value) }.getOrNull() }
