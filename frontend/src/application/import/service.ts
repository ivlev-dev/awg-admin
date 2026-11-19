import type { ImportRepository } from "@/domain/import/repository";
import type {
  ClientsApplyResult,
  ClientsImportInput,
  ClientsPreview,
  ImportApplyResult,
  ImportClientInput,
  ImportInput,
  ImportInterfaceInput,
  ImportPreview,
  LegacyImportInput,
} from "@/domain/import/types";
import {
  normalizeClientsApplyResult,
  normalizeClientsPreview,
  normalizeImportApplyResult,
  normalizeImportPreview,
} from "@/domain/import/normalize";
import { isServerConfig } from "@/domain/import/validation";
import type { PoolInput } from "@/domain/groups/types";
import type { ImportResult } from "@/domain/types";
import { cidrContains, cidrsOverlap, isCidr } from "@/domain/validation";
import { ValidationError } from "../errors";
import { requireId, requireMtu, requirePort, requireText } from "../guards";

export interface ImportService {
  preview(input: ImportInput): Promise<ImportPreview>;
  apply(input: ImportInput): Promise<ImportApplyResult>;
  previewClients(input: ClientsImportInput): Promise<ClientsPreview>;
  applyClients(input: ClientsImportInput): Promise<ClientsApplyResult>;
  importConfig(input: LegacyImportInput): Promise<ImportResult>;
}

export class DefaultImportService implements ImportService {
  constructor(private readonly repository: ImportRepository) {}

  async preview(input: ImportInput): Promise<ImportPreview> {
    return normalizeImportPreview(await this.repository.preview(normalizeImport(input)));
  }

  async apply(input: ImportInput): Promise<ImportApplyResult> {
    return normalizeImportApplyResult(await this.repository.apply(normalizeImport(input)));
  }

  async previewClients(input: ClientsImportInput): Promise<ClientsPreview> {
    return normalizeClientsPreview(
      await this.repository.previewClients(normalizeClientsImport(input)),
    );
  }

  async applyClients(input: ClientsImportInput): Promise<ClientsApplyResult> {
    return normalizeClientsApplyResult(
      await this.repository.applyClients(normalizeClientsImport(input)),
    );
  }

  async importConfig(input: LegacyImportInput): Promise<ImportResult> {
    return this.repository.importConfig(normalizeLegacyImport(input));
  }
}

function normalizeImport(input: ImportInput): ImportInput {
  const baseCidr = requireBaseCidr(input.base_cidr);
  if (input.interfaces.length === 0) {
    throw new ValidationError("error.validation.importInterfacesRequired");
  }

  const names = new Set<string>();
  const interfaces = input.interfaces.map((iface) => {
    const normalized = normalizeInterface(iface, baseCidr);
    const key = normalized.name.toLowerCase();
    if (names.has(key)) {
      throw new ValidationError("error.validation.importInterfaceDuplicate", { name: normalized.name });
    }
    names.add(key);
    return normalized;
  });

  return {
    node_id: requireId(input.node_id, "error.label.node"),
    group_name: requireText(input.group_name, "error.label.groupName"),
    group_description: input.group_description.trim(),
    base_cidr: baseCidr,
    owner_user_id: input.owner_user_id ? input.owner_user_id.trim() || null : null,
    interfaces,
  };
}

function normalizeInterface(iface: ImportInterfaceInput, baseCidr: string): ImportInterfaceInput {
  const serverConfig = requireText(iface.server_config, "error.label.serverConfig");
  if (!isServerConfig(serverConfig)) {
    throw new ValidationError("error.validation.importServerConfig");
  }
  const name = requireText(iface.name, "error.label.interfaceName");
  return {
    server_config: serverConfig,
    name,
    label: iface.label.trim(),
    endpoint_host: requireText(iface.endpoint_host, "error.label.endpointHost"),
    endpoint_port: requirePort(iface.endpoint_port, "error.label.endpointPort"),
    listen_port: requirePort(iface.listen_port, "error.label.listenPort"),
    mtu: requireMtu(iface.mtu),
    pools: normalizePools(iface.pools, baseCidr),
    clients: normalizeClients(iface.clients),
  };
}

function normalizePools(pools: PoolInput[], baseCidr: string): PoolInput[] {
  if (pools.length === 0) {
    throw new ValidationError("error.validation.importPoolsRequired");
  }
  const names = new Set<string>();
  const normalized = pools.map((pool) => {
    const name = requireText(pool.name, "error.label.poolName");
    const key = name.toLowerCase();
    if (names.has(key)) {
      throw new ValidationError("error.validation.importPoolDuplicate", { name });
    }
    names.add(key);
    const cidr = pool.cidr.trim();
    if (!isCidr(cidr)) {
      throw new ValidationError("error.validation.importPoolCidr", { cidr: pool.cidr });
    }
    if (!cidrContains(baseCidr, cidr)) {
      throw new ValidationError("error.validation.importPoolOutside", { name, base: baseCidr });
    }
    return {
      name,
      cidr,
      mode: pool.mode,
      gateway: pool.gateway?.trim() ? pool.gateway.trim() : null,
    };
  });

  for (let index = 0; index < normalized.length; index += 1) {
    const pool = normalized[index];
    if (!pool) continue;
    for (let otherIndex = index + 1; otherIndex < normalized.length; otherIndex += 1) {
      const other = normalized[otherIndex];
      if (!other) continue;
      if (cidrsOverlap(pool.cidr, other.cidr)) {
        throw new ValidationError("error.validation.importPoolsOverlap", {
          first: pool.name,
          second: other.name,
        });
      }
    }
  }

  return normalized;
}

function normalizeClients(clients: ImportClientInput[]): ImportClientInput[] {
  return clients.map((client) => ({
    name: requireText(client.name, "error.label.clientName"),
    config: requireText(client.config, "error.label.clientConfig"),
  }));
}

function normalizeClientsImport(input: ClientsImportInput): ClientsImportInput {
  if (input.clients.length === 0) {
    throw new ValidationError("error.validation.importClientsRequired");
  }
  return {
    interface_id: input.interface_id?.trim() ? input.interface_id.trim() : null,
    owner_user_id: input.owner_user_id?.trim() ? input.owner_user_id.trim() : null,
    clients: normalizeClients(input.clients),
  };
}

function normalizeLegacyImport(input: LegacyImportInput): LegacyImportInput {
  const baseCidr = requireBaseCidr(input.base_cidr);
  const serverConfig = requireText(input.server_config, "error.label.serverConfig");
  if (!isServerConfig(serverConfig)) {
    throw new ValidationError("error.validation.importServerConfig");
  }
  return {
    server_config: serverConfig,
    node_id: requireId(input.node_id, "error.label.node"),
    group_name: requireText(input.group_name, "error.label.groupName"),
    group_description: input.group_description.trim(),
    base_cidr: baseCidr,
    pools: normalizePools(input.pools, baseCidr),
    interface: {
      name: requireText(input.interface.name, "error.label.interfaceName"),
      endpoint_host: requireText(input.interface.endpoint_host, "error.label.endpointHost"),
      endpoint_port: requirePort(input.interface.endpoint_port, "error.label.endpointPort"),
      listen_port: requirePort(input.interface.listen_port, "error.label.listenPort"),
      mtu: requireMtu(input.interface.mtu),
    },
    clients: normalizeClients(input.clients),
    owner_user_id: input.owner_user_id ? input.owner_user_id.trim() || null : null,
  };
}

function requireBaseCidr(value: string): string {
  const cidr = value.trim();
  if (!isCidr(cidr)) {
    throw new ValidationError("error.validation.importCidr", { cidr: value });
  }
  return cidr;
}
