import type { DevicesService } from "@/application/devices/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { NodesService } from "@/application/nodes/service";
import type { QuotaService, QuotaSnapshot, UserQuotaSnapshot } from "@/application/quota/service";
import type { TariffsService } from "@/application/tariffs/service";
import type { UsersService } from "@/application/users/service";
import type { Device, InterfaceInfo, NodeInfo, Tariff, User } from "@/domain/types";

export type LookupKind =
  | "interfaces"
  | "tariffs"
  | "nodes"
  | "users"
  | "quotas"
  | "quota-me"
  | "devices";

const LOOKUP_TTL_MS = 60_000;
const OWNER_DEVICES_LIMIT = 200;
const OWNER_DEVICES_MAX_PAGES = 5;

interface CacheEntry {
  readonly expiresAt: number;
  readonly promise: Promise<unknown>;
}

const stores = new Map<object, Map<string, CacheEntry>>();

function bucket(owner: object): Map<string, CacheEntry> {
  const existing = stores.get(owner);
  if (existing !== undefined) return existing;
  const created = new Map<string, CacheEntry>();
  stores.set(owner, created);
  return created;
}

function readThrough<T>(owner: object, key: string, load: () => Promise<T>): Promise<T> {
  const cache = bucket(owner);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing !== undefined && existing.expiresAt > now) {
    return existing.promise as Promise<T>;
  }
  const promise = load().catch((error: unknown) => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: now + LOOKUP_TTL_MS, promise });
  return promise;
}

export function invalidate(kind: LookupKind, owner?: object): void {
  const prefix = `${kind}:`;
  if (owner !== undefined) {
    const cache = stores.get(owner);
    if (cache === undefined) return;
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
    return;
  }
  for (const cache of stores.values()) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
}

export function clearLookups(): void {
  stores.clear();
}

export function lookupInterfaces(service: InterfacesService): Promise<InterfaceInfo[]> {
  return readThrough(service, "interfaces:list", () => service.listInterfaces());
}

export function lookupTariffs(service: TariffsService): Promise<Tariff[]> {
  return readThrough(service, "tariffs:list", () => service.listTariffs());
}

export function lookupNodes(service: NodesService): Promise<NodeInfo[]> {
  return readThrough(service, "nodes:list", () => service.listNodes());
}

export function lookupUsers(service: UsersService): Promise<User[]> {
  return readThrough(service, "users:list", () => service.listUsers());
}

export function lookupQuotas(service: QuotaService): Promise<UserQuotaSnapshot[]> {
  return readThrough(service, "quotas:list", () => service.users());
}

export function lookupQuotaMe(service: QuotaService): Promise<QuotaSnapshot> {
  return readThrough(service, "quota-me:current", () => service.me());
}

export function lookupQuotaForUser(
  service: QuotaService,
  userId: string,
): Promise<UserQuotaSnapshot | null> {
  return lookupQuotas(service).then(
    (quotas) => quotas.find((quota) => quota.userId === userId) ?? null,
  );
}

export function lookupOwnerDevices(
  service: DevicesService,
  userId: string,
): Promise<Device[]> {
  return readThrough(service, `devices:owner:${userId}`, () => fetchOwnerDevices(service, userId));
}

async function fetchOwnerDevices(service: DevicesService, userId: string): Promise<Device[]> {
  const devices: Device[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < OWNER_DEVICES_MAX_PAGES; page += 1) {
    const result = await service.pageDevices({
      userId,
      limit: OWNER_DEVICES_LIMIT,
      offset,
    });
    for (const device of result.items) {
      if (seen.has(device.id)) continue;
      seen.add(device.id);
      devices.push(device);
    }
    if (result.items.length === 0 || devices.length >= result.total) break;
    offset += result.items.length;
  }
  return devices;
}
