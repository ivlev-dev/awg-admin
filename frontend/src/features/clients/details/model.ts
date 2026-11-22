import { userMessage } from "@/application/errors";
import type { Device, Forwarding, InterfaceInfo } from "@/domain/types";
import { t, type TranslationKey } from "@/i18n";

import type { ForwardingMode, TunnelRow, TunnelSeed } from "./types";

export const FORWARDING_MODES: readonly ForwardingMode[] = ["off", "all", "selected"];

export const FORWARDING_MODE_KEYS: Record<ForwardingMode, TranslationKey> = {
  off: "clients.details.forwarding.mode.off",
  all: "clients.details.forwarding.mode.all",
  selected: "clients.details.forwarding.mode.selected",
};

export function modeOfForwarding(forwarding: Forwarding | null | undefined): ForwardingMode {
  if (!forwarding) return "off";
  if (forwarding.to_own_devices) return "all";
  return forwarding.allowed_devices.length > 0 ? "selected" : "off";
}

export function forwardingPayload(mode: ForwardingMode, allowed: string[]): Forwarding {
  if (mode === "all") return { to_own_devices: true, allowed_devices: [] };
  if (mode === "selected") return { to_own_devices: false, allowed_devices: [...allowed] };
  return { to_own_devices: false, allowed_devices: [] };
}

export function parseForwardingMode(value: string): ForwardingMode {
  return value === "all" || value === "selected" ? value : "off";
}

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function sanitizeFilePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "device";
}

export function tunnelLabel(
  label: string | undefined,
  fallback: string | undefined,
  interfaceName: string,
): string {
  const value = label?.trim() || fallback?.trim() || "";
  return value.length > 0 ? value : interfaceName;
}

function compareTunnelOrder(left: TunnelSeed, right: TunnelSeed): number {
  return (
    left.interfaceName.localeCompare(right.interfaceName) ||
    left.label.localeCompare(right.label) ||
    left.peerId.localeCompare(right.peerId)
  );
}

export function withPrimaryPeer(seeds: TunnelSeed[]): TunnelRow[] {
  const primary = new Map<string, TunnelSeed>();
  for (const seed of seeds) {
    const current = primary.get(seed.interfaceId);
    if (current === undefined || compareTunnelOrder(seed, current) < 0) {
      primary.set(seed.interfaceId, seed);
    }
  }
  return [...seeds].sort(compareTunnelOrder).map((seed) => ({
    ...seed,
    primary: primary.get(seed.interfaceId)?.peerId === seed.peerId,
  }));
}

export function interfaceFitsDevice(item: InterfaceInfo, device: Device): boolean {
  if (device.group_id.length > 0 && item.group_id !== device.group_id) return false;
  if (device.node_id.length > 0 && item.node_id !== device.node_id) return false;
  return true;
}

export function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "status") === 409;
}

export function tunnelError(error: unknown, fallback: string): string {
  if (isConflict(error)) return t("clients.details.tunnels.conflict");
  return userMessage(error, fallback);
}
