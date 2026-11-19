import type { Tariff } from "./types";

export type TariffValidationTarget = Pick<
  Tariff,
  | "name"
  | "max_devices"
  | "device_down_kbps"
  | "device_up_kbps"
  | "group_down_kbps"
  | "group_up_kbps"
>;

export type TariffValidationCode =
  | "error.validation.tariffName"
  | "error.validation.tariffMaxDevices"
  | "error.validation.tariffDeviceDown"
  | "error.validation.tariffDeviceUp";

export interface TariffValidationIssue {
  readonly code: TariffValidationCode;
}

export function validateTariff(tariff: TariffValidationTarget): TariffValidationIssue | null {
  if (!tariff.name.trim()) return { code: "error.validation.tariffName" };
  if (tariff.max_devices <= 0) return { code: "error.validation.tariffMaxDevices" };
  if (
    tariff.device_down_kbps > 0 &&
    tariff.group_down_kbps > 0 &&
    tariff.device_down_kbps > tariff.group_down_kbps
  ) {
    return { code: "error.validation.tariffDeviceDown" };
  }
  if (
    tariff.device_up_kbps > 0 &&
    tariff.group_up_kbps > 0 &&
    tariff.device_up_kbps > tariff.group_up_kbps
  ) {
    return { code: "error.validation.tariffDeviceUp" };
  }
  return null;
}

export function isCidr(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  return octets.every((octet) => octet >= 0 && octet <= 255) && prefix >= 0 && prefix <= 32;
}

export function cidrContains(parent: string, child: string): boolean {
  const base = toRange(parent);
  const inner = toRange(child);
  if (!base || !inner) return false;
  return inner.start >= base.start && inner.end <= base.end;
}

export function cidrsOverlap(left: string, right: string): boolean {
  const first = toRange(left);
  const second = toRange(right);
  if (!first || !second) return false;
  return first.start <= second.end && second.start <= first.end;
}

function toRange(cidr: string): { start: number; end: number } | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const [o0, o1, o2, o3] = [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
  const prefix = Number(match[5]);
  if ([o0, o1, o2, o3].some((o) => o > 255) || prefix > 32) return null;
  const ip = ((o0 << 24) >>> 0) + (o1 << 16) + (o2 << 8) + o3;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (ip & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end };
}
