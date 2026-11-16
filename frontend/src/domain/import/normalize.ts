import type {
  ClientsApplyResult,
  ClientsApplyResultWire,
  ClientsPreview,
  ClientsPreviewInterface,
  ClientsPreviewInterfaceWire,
  ClientsPreviewSummary,
  ClientsPreviewWire,
  ImportApplyResult,
  ImportApplyResultWire,
  ImportClientChange,
  ImportClientChangeField,
  ImportClientStatus,
  ImportPreview,
  ImportPreviewClient,
  ImportPreviewClientWire,
  ImportPreviewCounts,
  ImportPreviewCountsWire,
  ImportPreviewInterface,
  ImportPreviewInterfaceWire,
  ImportPreviewServerPeer,
  ImportPreviewServerPeerWire,
  ImportPreviewSummary,
  ImportPreviewSummaryWire,
  ImportPreviewWire,
  ImportServerPeerCounts,
  ImportServerPeerCountsWire,
  ImportServerPeerStatus,
} from "./types";

const CLIENT_STATUSES: readonly ImportClientStatus[] = [
  "create",
  "unchanged",
  "update",
  "duplicate",
  "error",
];

const SERVER_PEER_STATUSES: readonly ImportServerPeerStatus[] = [
  "create",
  "duplicate",
  "error",
];

const CHANGE_FIELDS: readonly ImportClientChangeField[] = ["address", "preshared_key", "name"];

const EMPTY_COUNTS: ImportPreviewCounts = {
  create: 0,
  unchanged: 0,
  update: 0,
  duplicate: 0,
  error: 0,
};

const EMPTY_SERVER_PEER_COUNTS: ImportServerPeerCounts = {
  create: 0,
  duplicate: 0,
  error: 0,
};

function toNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function clientStatus(value: string | null | undefined): ImportClientStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  return CLIENT_STATUSES.find((status) => status === normalized) ?? "error";
}

function serverPeerStatus(value: string | null | undefined): ImportServerPeerStatus {
  const normalized = typeof value === "string" ? value.trim() : "";
  return SERVER_PEER_STATUSES.find((status) => status === normalized) ?? "error";
}

function changeField(value: string | null | undefined): ImportClientChangeField | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return CHANGE_FIELDS.find((field) => field === normalized) ?? null;
}

function normalizeChange(wire: ImportPreviewClientWire["changes"]): ImportClientChange[] {
  if (!Array.isArray(wire)) return [];
  const changes: ImportClientChange[] = [];
  for (const item of wire) {
    const field = changeField(item?.field);
    if (field === null) continue;
    changes.push({ field, from: toText(item?.from), to: toText(item?.to) });
  }
  return changes;
}

function normalizeClient(wire: ImportPreviewClientWire): ImportPreviewClient {
  return {
    name: typeof wire.name === "string" ? wire.name : "",
    status: clientStatus(wire.status),
    address: toText(wire.address),
    reason: toText(wire.reason),
    device_id: toText(wire.device_id),
    changes: normalizeChange(wire.changes),
  };
}

function normalizeServerPeer(wire: ImportPreviewServerPeerWire): ImportPreviewServerPeer | null {
  const publicKey = toText(wire.public_key);
  if (publicKey === null) return null;
  return {
    public_key: publicKey,
    status: serverPeerStatus(wire.status),
    address: toText(wire.address),
    reason: toText(wire.reason),
  };
}

export function countClients(clients: ImportPreviewClient[]): ImportPreviewCounts {
  const counts: ImportPreviewCounts = { ...EMPTY_COUNTS };
  for (const client of clients) counts[client.status] += 1;
  return counts;
}

export function countServerPeers(peers: ImportPreviewServerPeer[]): ImportServerPeerCounts {
  const counts: ImportServerPeerCounts = { ...EMPTY_SERVER_PEER_COUNTS };
  for (const peer of peers) counts[peer.status] += 1;
  return counts;
}

function pickCounts(
  wire: ImportPreviewCountsWire | null | undefined,
  fallback: ImportPreviewCounts,
): ImportPreviewCounts {
  return {
    create: toNumber(wire?.create, fallback.create),
    unchanged: toNumber(wire?.unchanged, fallback.unchanged),
    update: toNumber(wire?.update, fallback.update),
    duplicate: toNumber(wire?.duplicate, fallback.duplicate),
    error: toNumber(wire?.error, fallback.error),
  };
}

function pickServerPeerCounts(
  wire: ImportServerPeerCountsWire | null | undefined,
  fallback: ImportServerPeerCounts,
): ImportServerPeerCounts {
  return {
    create: toNumber(wire?.create, fallback.create),
    duplicate: toNumber(wire?.duplicate, fallback.duplicate),
    error: toNumber(wire?.error, fallback.error),
  };
}

function sumClientsCounts(interfaces: ImportPreviewInterface[]): ImportPreviewCounts {
  const total: ImportPreviewCounts = { ...EMPTY_COUNTS };
  for (const iface of interfaces) {
    total.create += iface.counts.create;
    total.unchanged += iface.counts.unchanged;
    total.update += iface.counts.update;
    total.duplicate += iface.counts.duplicate;
    total.error += iface.counts.error;
  }
  return total;
}

function sumServerPeerCounts(interfaces: ImportPreviewInterface[]): ImportServerPeerCounts {
  const total: ImportServerPeerCounts = { ...EMPTY_SERVER_PEER_COUNTS };
  for (const iface of interfaces) {
    total.create += iface.server_peer_counts.create;
    total.duplicate += iface.server_peer_counts.duplicate;
    total.error += iface.server_peer_counts.error;
  }
  return total;
}

function normalizeInterface(wire: ImportPreviewInterfaceWire, index: number): ImportPreviewInterface {
  const clients = Array.isArray(wire.clients) ? wire.clients.map(normalizeClient) : [];
  const serverPeers = Array.isArray(wire.server_peers)
    ? wire.server_peers
        .map(normalizeServerPeer)
        .filter((peer): peer is ImportPreviewServerPeer => peer !== null)
    : [];
  return {
    index: toNumber(wire.index, index),
    name: typeof wire.name === "string" ? wire.name : "",
    public_key: toText(wire.public_key),
    clients,
    server_peers: serverPeers,
    counts: pickCounts(wire.counts, countClients(clients)),
    server_peer_counts: pickServerPeerCounts(
      wire.server_peer_counts ?? wire.peer_counts,
      countServerPeers(serverPeers),
    ),
  };
}

function normalizeSummary(
  wire: ImportPreviewSummaryWire | null | undefined,
  interfaces: ImportPreviewInterface[],
): ImportPreviewSummary {
  return {
    ...pickCounts(wire, sumClientsCounts(interfaces)),
    interfaces: toNumber(wire?.interfaces, interfaces.length),
    external: pickServerPeerCounts(wire?.external ?? wire?.server_peers, sumServerPeerCounts(interfaces)),
  };
}

function normalizeWarnings(wire: string[] | null | undefined): string[] {
  return Array.isArray(wire) ? wire.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeImportPreview(wire: ImportPreviewWire): ImportPreview {
  const interfaces = Array.isArray(wire.interfaces)
    ? wire.interfaces.map((iface, index) => normalizeInterface(iface, index))
    : [];
  return {
    group: {
      name: typeof wire.group?.name === "string" ? wire.group.name : "",
      description: wire.group?.description,
      base_cidr: wire.group?.base_cidr,
    },
    interfaces,
    summary: normalizeSummary(wire.summary, interfaces),
    warnings: normalizeWarnings(wire.warnings),
  };
}

export function normalizeImportApplyResult(wire: ImportApplyResultWire): ImportApplyResult {
  return {
    ...normalizeImportPreview(wire),
    created: wire.created,
  };
}

function normalizeClientsInterface(
  wire: ClientsPreviewInterfaceWire,
): ClientsPreviewInterface {
  const clients = Array.isArray(wire.clients) ? wire.clients.map(normalizeClient) : [];
  return {
    id: wire.id,
    name: wire.name,
    group_id: wire.group_id,
    group_name: wire.group_name,
    node_id: wire.node_id,
    public_key: wire.public_key,
    clients,
    counts: pickCounts(wire.counts, countClients(clients)),
  };
}

function sumClientsInterfaceCounts(
  interfaces: ClientsPreviewInterface[],
): ImportPreviewCounts {
  const total: ImportPreviewCounts = { ...EMPTY_COUNTS };
  for (const iface of interfaces) {
    total.create += iface.counts.create;
    total.unchanged += iface.counts.unchanged;
    total.update += iface.counts.update;
    total.duplicate += iface.counts.duplicate;
    total.error += iface.counts.error;
  }
  return total;
}

function normalizeClientsSummary(
  wire: ClientsPreviewWire["summary"],
  interfaces: ClientsPreviewInterface[],
): ClientsPreviewSummary {
  return {
    ...pickCounts(wire, sumClientsInterfaceCounts(interfaces)),
    interfaces: toNumber(wire?.interfaces, interfaces.length),
  };
}

export function normalizeClientsPreview(wire: ClientsPreviewWire): ClientsPreview {
  const interfaces = Array.isArray(wire.interfaces)
    ? wire.interfaces.map(normalizeClientsInterface)
    : [];
  return {
    interfaces,
    summary: normalizeClientsSummary(wire.summary, interfaces),
    warnings: normalizeWarnings(wire.warnings),
  };
}

export function normalizeClientsApplyResult(wire: ClientsApplyResultWire): ClientsApplyResult {
  return {
    ...normalizeClientsPreview(wire),
    created: wire.created,
  };
}
