import type { PoolInput } from "../groups/types";

export interface ImportClientInput {
  name: string;
  config: string;
}

export interface ImportInterfaceInput {
  server_config: string;
  name: string;
  label: string;
  endpoint_host: string;
  endpoint_port: number;
  listen_port: number;
  mtu: number;
  pools: PoolInput[];
  clients: ImportClientInput[];
}

export interface ImportInput {
  node_id: string;
  group_name: string;
  group_description: string;
  base_cidr: string;
  owner_user_id: string | null;
  interfaces: ImportInterfaceInput[];
}

export interface LegacyImportInput {
  server_config: string;
  node_id: string;
  group_name: string;
  group_description: string;
  base_cidr: string;
  pools: PoolInput[];
  interface: {
    name: string;
    endpoint_host: string;
    endpoint_port: number;
    listen_port: number;
    mtu: number;
  };
  clients: ImportClientInput[];
  owner_user_id: string | null;
}

export type ImportClientStatus = "create" | "duplicate" | "error";

export interface ImportPreviewClient {
  name: string;
  status: ImportClientStatus;
  address: string | null;
  reason: string | null;
}

export interface ImportPreviewCounts {
  create: number;
  duplicate: number;
  error: number;
}

export interface ImportPreviewInterface {
  index: number;
  name: string;
  public_key: string | null;
  clients: ImportPreviewClient[];
  counts: ImportPreviewCounts;
}

export interface ImportPreviewSummary extends ImportPreviewCounts {
  interfaces: number;
}

export interface ImportPreviewGroup {
  name: string;
  description?: string;
  base_cidr?: string;
}

export interface ImportPreview {
  group: ImportPreviewGroup;
  interfaces: ImportPreviewInterface[];
  summary: ImportPreviewSummary;
  warnings: string[];
}

export interface ImportCreatedInterface {
  id: string;
  name: string;
  device_ids: string[];
}

export interface ImportCreated {
  group_id: string;
  interfaces: ImportCreatedInterface[];
}

export interface ImportApplyResult extends ImportPreview {
  created: ImportCreated;
}

export interface ClientsImportInput {
  interface_id: string | null;
  owner_user_id: string | null;
  clients: ImportClientInput[];
}

export interface ClientsPreviewInterface {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  node_id: string;
  public_key: string;
  clients: ImportPreviewClient[];
  counts: ImportPreviewCounts;
}

export interface ClientsPreviewSummary extends ImportPreviewCounts {
  interfaces: number;
}

export interface ClientsPreview {
  interfaces: ClientsPreviewInterface[];
  summary: ClientsPreviewSummary;
  warnings: string[];
}

export interface ClientsCreatedInterface {
  id: string;
  device_ids: string[];
}

export interface ClientsCreated {
  interfaces: ClientsCreatedInterface[];
}

export interface ClientsApplyResult extends ClientsPreview {
  created: ClientsCreated;
}

