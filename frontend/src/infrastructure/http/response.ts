import type { Page } from "@/domain/page";
import type { Device, InterfaceInfo, ShareLink, User } from "@/domain/types";
import { ApiError } from "./errors";

type RecordValue = Readonly<Record<string, unknown>>;

const USER_STATUSES: ReadonlySet<string> = new Set([
  "pending_email",
  "pending_approval",
  "active",
  "rejected",
]);

const SHARE_FORMATS: ReadonlySet<string> = new Set(["conf", "vpn"]);

export function invalidResponse(what: string): ApiError {
  return new ApiError(200, "invalid_response", `Invalid response payload: ${what}`);
}

export function readDevice(value: unknown): Device {
  const record = expectRecord(value, "device");
  expectString(record, "id", "device");
  expectString(record, "user_id", "device");
  expectString(record, "group_id", "device");
  expectString(record, "interface_id", "device");
  expectString(record, "interface_name", "device");
  expectString(record, "node_id", "device");
  expectString(record, "node_name", "device");
  expectString(record, "name", "device");
  expectNumber(record, "down_kbps", "device");
  expectNumber(record, "up_kbps", "device");
  expectRecord(record["forwarding"], "device.forwarding");
  expectBoolean(record, "revoked", "device");
  expectString(record, "created_at", "device");
  expectArray(record["peers"], "device.peers");
  expectArray(record["addresses"], "device.addresses");
  return value as Device;
}

export function readDevices(value: unknown): Device[] {
  return expectArray(value, "devices").map(readDevice);
}

export function readDevicePage(value: unknown): Page<Device> {
  return readPage(value, readDevice, "devices");
}

export function readUser(value: unknown): User {
  const record = expectRecord(value, "user");
  expectString(record, "id", "user");
  expectString(record, "email", "user");
  expectNullableString(record, "full_name", "user");
  expectOneOf(record, "status", USER_STATUSES, "user");
  expectBoolean(record, "totp_enabled", "user");
  expectOneOf(record, "role", new Set(["admin", "user"]), "user");
  expectNullableString(record, "tariff_id", "user");
  expectNullableString(record, "group_id", "user");
  expectBoolean(record, "disabled", "user");
  expectString(record, "created_at", "user");
  expectString(record, "updated_at", "user");
  return value as User;
}

export function readUsers(value: unknown): User[] {
  return expectArray(value, "users").map(readUser);
}

export function readUserPage(value: unknown): Page<User> {
  return readPage(value, readUser, "users");
}

export function readInterfaceInfo(value: unknown): InterfaceInfo {
  const record = expectRecord(value, "interface");
  for (const key of [
    "id",
    "group_id",
    "group_name",
    "node_id",
    "node_name",
    "name",
    "label",
    "endpoint_host",
    "public_key",
  ]) {
    expectString(record, key, "interface");
  }
  for (const key of ["endpoint_port", "listen_port", "mtu", "peers"]) {
    expectNumber(record, key, "interface");
  }
  const obf = expectRecord(record["obf"], "interface.obf");
  for (const key of ["h1", "h2", "h3", "h4"]) {
    expectRecord(obf[key], `interface.obf.${key}`);
  }
  for (const key of ["s1", "s2", "s3", "s4"]) {
    expectNumber(obf, key, "interface.obf");
  }
  expectBoolean(record, "enabled", "interface");
  return value as InterfaceInfo;
}

export function readInterfaces(value: unknown): InterfaceInfo[] {
  return expectArray(value, "interfaces").map(readInterfaceInfo);
}

export function readShareLink(value: unknown): ShareLink {
  const record = expectRecord(value, "share");
  for (const key of ["token", "device_id", "interface_id", "expires_at", "created_at", "url", "state"]) {
    expectString(record, key, "share");
  }
  expectOneOf(record, "format", SHARE_FORMATS, "share");
  expectNullableString(record, "used_at", "share");
  expectNullableNumber(record, "max_uses", "share");
  expectNumber(record, "uses", "share");
  expectNullableNumber(record, "remaining_uses", "share");
  expectNullableString(record, "revoked_at", "share");
  return value as ShareLink;
}

export function readShareLinks(value: unknown): ShareLink[] {
  return expectArray(value, "shares").map(readShareLink);
}

function readPage<T>(
  value: unknown,
  readItem: (item: unknown) => T,
  what: string,
): Page<T> {
  const record = expectRecord(value, what);
  return {
    items: expectArray(record["items"], `${what}.items`).map(readItem),
    total: expectNumber(record, "total", what),
    limit: expectNumber(record, "limit", what),
    offset: expectNumber(record, "offset", what),
  };
}

function expectRecord(value: unknown, what: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(what);
  }
  return value as RecordValue;
}

function expectArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(what);
  return value;
}

function expectString(record: RecordValue, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== "string") throw invalidResponse(`${what}.${key}`);
  return value;
}

function expectNullableString(record: RecordValue, key: string, what: string): string | null {
  const value = record[key];
  if (value !== null && typeof value !== "string") throw invalidResponse(`${what}.${key}`);
  return value;
}

function expectNumber(record: RecordValue, key: string, what: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResponse(`${what}.${key}`);
  return value;
}

function expectNullableNumber(record: RecordValue, key: string, what: string): number | null {
  const value = record[key];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw invalidResponse(`${what}.${key}`);
  }
  return value;
}

function expectBoolean(record: RecordValue, key: string, what: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw invalidResponse(`${what}.${key}`);
  return value;
}

function expectOneOf(
  record: RecordValue,
  key: string,
  allowed: ReadonlySet<string>,
  what: string,
): string {
  const value = expectString(record, key, what);
  if (!allowed.has(value)) throw invalidResponse(`${what}.${key}`);
  return value;
}
