import type { Tariff } from "./types";

export interface Limits {
  down: number;
  up: number;
}

export function clampDeviceLimits(tariff: Tariff, requested: Limits): Limits {
  return {
    down: clampTo(tariff.device_down_kbps, requested.down),
    up: clampTo(tariff.device_up_kbps, requested.up),
  };
}

function clampTo(max: number, requested: number): number {
  if (max <= 0) return Math.max(0, requested);
  if (requested <= 0) return max;
  return Math.min(max, requested);
}

export function validateGroupSum(tariff: Tariff, devices: Limits[]): string | null {
  const down = devices.reduce((sum, d) => sum + d.down, 0);
  const up = devices.reduce((sum, d) => sum + d.up, 0);
  if (tariff.group_down_kbps > 0 && down > tariff.group_down_kbps) {
    return `Суммарная скорость скачивания (${down} Кбит/с) превышает лимит тарифа (${tariff.group_down_kbps} Кбит/с)`;
  }
  if (tariff.group_up_kbps > 0 && up > tariff.group_up_kbps) {
    return `Суммарная скорость отдачи (${up} Кбит/с) превышает лимит тарифа (${tariff.group_up_kbps} Кбит/с)`;
  }
  return null;
}

export function validateTariff(tariff: Omit<Tariff, "id" | "created_at" | "updated_at">): string | null {
  if (!tariff.name.trim()) return "Название тарифа обязательно";
  if (tariff.max_devices <= 0) return "Тариф должен разрешать хотя бы одно устройство";
  if (
    tariff.device_down_kbps > 0 &&
    tariff.group_down_kbps > 0 &&
    tariff.device_down_kbps > tariff.group_down_kbps
  ) {
    return "Лимит устройства не может превышать лимит группы";
  }
  if (
    tariff.device_up_kbps > 0 &&
    tariff.group_up_kbps > 0 &&
    tariff.device_up_kbps > tariff.group_up_kbps
  ) {
    return "Лимит отдачи устройства не может превышать лимит группы";
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
