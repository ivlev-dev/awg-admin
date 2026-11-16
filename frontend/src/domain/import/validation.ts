import { cidrContains, cidrsOverlap, isCidr } from "../validation";
import type { ImportInput } from "./types";

export type ImportGroupIssue =
  | { code: "group.name.required" }
  | { code: "base_cidr.invalid" }
  | { code: "node.required" }
  | { code: "interfaces.empty" };

export type ImportInterfaceIssue =
  | { code: "server_config.invalid"; interfaceIndex: number }
  | { code: "interface.name.required"; interfaceIndex: number }
  | { code: "interface.name.duplicate"; interfaceIndex: number }
  | { code: "endpoint.host.required"; interfaceIndex: number }
  | { code: "endpoint.port.invalid"; interfaceIndex: number }
  | { code: "listen.port.invalid"; interfaceIndex: number }
  | { code: "mtu.invalid"; interfaceIndex: number }
  | { code: "pool.name.required"; interfaceIndex: number; poolIndex: number }
  | { code: "pool.name.duplicate"; interfaceIndex: number; poolIndex: number }
  | { code: "pool.cidr.invalid"; interfaceIndex: number; poolIndex: number }
  | { code: "pool.cidr.outside_base"; interfaceIndex: number; poolIndex: number }
  | {
      code: "pool.overlap";
      interfaceIndex: number;
      poolIndex: number;
      relatedPoolIndex: number;
    }
  | { code: "client.name.required"; interfaceIndex: number; clientIndex: number }
  | { code: "client.config.required"; interfaceIndex: number; clientIndex: number };

export interface ImportValidation {
  group: ImportGroupIssue[];
  interfaces: ImportInterfaceIssue[][];
  valid: boolean;
}

export const CLIENT_SEPARATOR = /^[ \t]*---[ \t]*\r?$/m;

export function splitClientConfigs(text: string): string[] {
  return text
    .split(CLIENT_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isServerConfig(text: string): boolean {
  return /^\s*\[Interface\]\s*$/im.test(text) && /^\s*PrivateKey\s*=/im.test(text);
}

export function extractPeerPublicKey(config: string): string | null {
  const match = /\[Peer\][\s\S]*?^\s*PublicKey\s*=\s*(\S+)/im.exec(config);
  return match?.[1]?.trim() ?? null;
}

export function extractClientAddress(config: string): string {
  const match = /^\s*Address\s*=\s*(.+)$/im.exec(config);
  return match?.[1]?.trim() ?? "—";
}

export function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

export function isMtu(value: number): boolean {
  return Number.isInteger(value) && value >= 576 && value <= 9000;
}

export function validateImportInput(input: ImportInput): ImportValidation {
  const group: ImportGroupIssue[] = [];
  if (!input.group_name.trim()) group.push({ code: "group.name.required" });
  if (!isCidr(input.base_cidr)) group.push({ code: "base_cidr.invalid" });
  if (!input.node_id.trim()) group.push({ code: "node.required" });
  if (input.interfaces.length === 0) group.push({ code: "interfaces.empty" });

  const baseCidrValid = isCidr(input.base_cidr);
  const interfaceNames = new Map<string, number>();

  const interfaces = input.interfaces.map((iface, interfaceIndex) => {
    const issues: ImportInterfaceIssue[] = [];
    if (!isServerConfig(iface.server_config)) {
      issues.push({ code: "server_config.invalid", interfaceIndex });
    }

    const interfaceName = iface.name.trim().toLowerCase();
    if (!interfaceName) {
      issues.push({ code: "interface.name.required", interfaceIndex });
    } else {
      const previous = interfaceNames.get(interfaceName);
      if (previous !== undefined) {
        issues.push({ code: "interface.name.duplicate", interfaceIndex });
      } else {
        interfaceNames.set(interfaceName, interfaceIndex);
      }
    }

    if (!iface.endpoint_host.trim()) {
      issues.push({ code: "endpoint.host.required", interfaceIndex });
    }
    if (!isPort(iface.endpoint_port)) {
      issues.push({ code: "endpoint.port.invalid", interfaceIndex });
    }
    if (!isPort(iface.listen_port)) {
      issues.push({ code: "listen.port.invalid", interfaceIndex });
    }
    if (!isMtu(iface.mtu)) {
      issues.push({ code: "mtu.invalid", interfaceIndex });
    }

    const poolNames = new Map<string, number>();
    iface.pools.forEach((pool, poolIndex) => {
      const poolName = pool.name.trim().toLowerCase();
      if (!poolName) {
        issues.push({ code: "pool.name.required", interfaceIndex, poolIndex });
      } else if (poolNames.has(poolName)) {
        issues.push({ code: "pool.name.duplicate", interfaceIndex, poolIndex });
      } else {
        poolNames.set(poolName, poolIndex);
      }

      if (!isCidr(pool.cidr)) {
        issues.push({ code: "pool.cidr.invalid", interfaceIndex, poolIndex });
      } else if (baseCidrValid && !cidrContains(input.base_cidr, pool.cidr)) {
        issues.push({ code: "pool.cidr.outside_base", interfaceIndex, poolIndex });
      }
    });

    for (let poolIndex = 0; poolIndex < iface.pools.length; poolIndex += 1) {
      const pool = iface.pools[poolIndex];
      if (!pool || !isCidr(pool.cidr)) continue;
      for (let otherIndex = poolIndex + 1; otherIndex < iface.pools.length; otherIndex += 1) {
        const other = iface.pools[otherIndex];
        if (!other || !isCidr(other.cidr)) continue;
        if (cidrsOverlap(pool.cidr, other.cidr)) {
          issues.push({
            code: "pool.overlap",
            interfaceIndex,
            poolIndex,
            relatedPoolIndex: otherIndex,
          });
        }
      }
    }

    iface.clients.forEach((client, clientIndex) => {
      if (!client.name.trim()) {
        issues.push({ code: "client.name.required", interfaceIndex, clientIndex });
      }
      if (!client.config.trim()) {
        issues.push({ code: "client.config.required", interfaceIndex, clientIndex });
      }
    });

    return issues;
  });

  return {
    group,
    interfaces,
    valid: group.length === 0 && interfaces.every((issues) => issues.length === 0),
  };
}
