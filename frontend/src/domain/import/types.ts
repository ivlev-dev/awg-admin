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

export type ImportClientStatus = "create" | "unchanged" | "update" | "duplicate" | "error";

export type ImportServerPeerStatus = "create" | "duplicate" | "error";

export type ImportClientChangeField = "address" | "preshared_key" | "name";

export interface ImportClientChange {
  field: ImportClientChangeField;
  from: string | null;
  to: string | null;
}

export interface ImportPreviewClient {
  name: string;
  status: ImportClientStatus;
  address: string | null;
  reason: string | null;
  device_id: string | null;
  changes: ImportClientChange[];
}

export interface ImportPreviewServerPeer {
  public_key: string;
  status: ImportServerPeerStatus;
  address: string | null;
  reason: string | null;
}

export interface ImportPreviewCounts {
  create: number;
  unchanged: number;
  update: number;
  duplicate: number;
  error: number;
}

export interface ImportServerPeerCounts {
  create: number;
  duplicate: number;
  error: number;
}

export interface ImportPreviewInterface {
  index: number;
  name: string;
  public_key: string | null;
  clients: ImportPreviewClient[];
  server_peers: ImportPreviewServerPeer[];
  counts: ImportPreviewCounts;
  server_peer_counts: ImportServerPeerCounts;
}

export interface ImportPreviewSummary extends ImportPreviewCounts {
  interfaces: number;
  external: ImportServerPeerCounts;
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

export interface ImportPreviewCountsWire {
  create?: number | null;
  unchanged?: number | null;
  update?: number | null;
  duplicate?: number | null;
  error?: number | null;
}

export interface ImportServerPeerCountsWire {
  create?: number | null;
  duplicate?: number | null;
  error?: number | null;
}

export interface ImportClientChangeWire {
  field?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface ImportPreviewClientWire {
  name?: string | null;
  status?: string | null;
  address?: string | null;
  reason?: string | null;
  device_id?: string | null;
  changes?: ImportClientChangeWire[] | null;
}

export interface ImportPreviewServerPeerWire {
  public_key?: string | null;
  status?: string | null;
  address?: string | null;
  reason?: string | null;
}

export interface ImportPreviewInterfaceWire {
  index?: number | null;
  name?: string | null;
  public_key?: string | null;
  clients?: ImportPreviewClientWire[] | null;
  server_peers?: ImportPreviewServerPeerWire[] | null;
  counts?: ImportPreviewCountsWire | null;
  server_peer_counts?: ImportServerPeerCountsWire | null;
  peer_counts?: ImportServerPeerCountsWire | null;
}

export interface ImportPreviewSummaryWire extends ImportPreviewCountsWire {
  interfaces?: number | null;
  external?: ImportServerPeerCountsWire | null;
  server_peers?: ImportServerPeerCountsWire | null;
}

export interface ImportPreviewWire {
  group: ImportPreviewGroup;
  interfaces?: ImportPreviewInterfaceWire[] | null;
  summary?: ImportPreviewSummaryWire | null;
  warnings?: string[] | null;
}

export interface ImportApplyResultWire extends ImportPreviewWire {
  created: ImportCreated;
}

export interface ClientsPreviewInterfaceWire {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  node_id: string;
  public_key: string;
  clients?: ImportPreviewClientWire[] | null;
  counts?: ImportPreviewCountsWire | null;
}

export interface ClientsPreviewSummaryWire extends ImportPreviewCountsWire {
  interfaces?: number | null;
}

export interface ClientsPreviewWire {
  interfaces?: ClientsPreviewInterfaceWire[] | null;
  summary?: ClientsPreviewSummaryWire | null;
  warnings?: string[] | null;
}

export interface ClientsApplyResultWire extends ClientsPreviewWire {
  created: ClientsCreated;
}
