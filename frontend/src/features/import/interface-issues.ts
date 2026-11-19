import type {
  ImportClientChange,
  ImportClientChangeField,
  ImportClientStatus,
  ImportPreviewServerPeer,
  ImportServerPeerStatus,
} from "@/domain/import/types";
import type {
  ImportGroupIssue,
  ImportInterfaceIssue,
} from "@/domain/import/validation";
import { t } from "@/i18n";

import type { InterfaceDraft } from "./drafts";

const SHORT_KEY_PREFIX = 8;
const SHORT_KEY_SUFFIX = 4;
const PRESHARED_KEY_MASK = "•••";

export function isPoolIssue(issue: ImportInterfaceIssue, poolIndex: number): boolean {
  switch (issue.code) {
    case "pool.name.required":
    case "pool.name.duplicate":
    case "pool.cidr.invalid":
    case "pool.cidr.outside_base":
      return issue.poolIndex === poolIndex;
    case "pool.overlap":
      return issue.poolIndex === poolIndex || issue.relatedPoolIndex === poolIndex;
    default:
      return false;
  }
}

export function issueMessage(issue: ImportInterfaceIssue, interfaces: readonly InterfaceDraft[]): string {
  switch (issue.code) {
    case "server_config.invalid":
      return t("import.error.serverConfig");
    case "interface.name.required":
      return t("import.error.interfaceName");
    case "interface.name.duplicate":
      return t("import.error.interfaceNameDuplicate", {
        name: interfaces[issue.interfaceIndex]?.name.trim() ?? "",
      });
    case "endpoint.host.required":
      return t("import.error.endpointHost");
    case "endpoint.port.invalid":
    case "listen.port.invalid":
      return t("import.error.port");
    case "mtu.invalid":
      return t("import.error.mtu");
    case "pool.name.required":
      return t("import.error.poolName");
    case "pool.name.duplicate":
      return t("import.error.poolNameDuplicate", {
        name: poolName(interfaces, issue.interfaceIndex, issue.poolIndex),
      });
    case "pool.cidr.invalid":
      return t("import.error.poolCidr");
    case "pool.cidr.outside_base":
      return t("import.error.poolOutsideBase");
    case "pool.overlap":
      return t("import.error.poolOverlap", {
        first: poolLabel(interfaces, issue.interfaceIndex, issue.poolIndex),
        second: poolLabel(interfaces, issue.interfaceIndex, issue.relatedPoolIndex),
      });
    case "client.name.required":
      return t("import.error.clientName");
    case "client.config.required":
      return t("import.error.clientConfig");
  }
}

export function groupIssueMessage(issue: ImportGroupIssue): string {
  switch (issue.code) {
    case "group.name.required":
      return t("import.error.groupName");
    case "base_cidr.invalid":
      return t("import.error.baseCidr");
    case "node.required":
      return t("import.error.node");
    case "interfaces.empty":
      return t("import.interfaces.emptyText");
  }
}

export function previewStatusLabel(status: ImportClientStatus): string {
  switch (status) {
    case "create":
      return t("import.preview.status.create");
    case "unchanged":
      return t("import.preview.status.unchanged");
    case "update":
      return t("import.preview.status.update");
    case "duplicate":
      return t("import.preview.status.duplicate");
    case "error":
      return t("import.preview.status.error");
  }
}

export function previewStatusClass(status: ImportClientStatus): string {
  switch (status) {
    case "create":
      return "badge badge--green";
    case "unchanged":
      return "badge badge--gray";
    case "update":
      return "badge badge--blue";
    case "duplicate":
      return "badge badge--amber";
    case "error":
      return "badge badge--red";
  }
}

export function serverPeerStatusLabel(status: ImportServerPeerStatus): string {
  switch (status) {
    case "create":
      return t("import.preview.status.create");
    case "duplicate":
      return t("import.preview.status.duplicate");
    case "error":
      return t("import.preview.status.error");
  }
}

export function serverPeerStatusClass(status: ImportServerPeerStatus): string {
  switch (status) {
    case "create":
      return "badge badge--green";
    case "duplicate":
      return "badge badge--amber";
    case "error":
      return "badge badge--red";
  }
}

export function shortKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= SHORT_KEY_PREFIX + SHORT_KEY_SUFFIX) return trimmed;
  return `${trimmed.slice(0, SHORT_KEY_PREFIX)}…${trimmed.slice(-SHORT_KEY_SUFFIX)}`;
}

export function serverPeerAddress(peer: ImportPreviewServerPeer): string {
  return peer.address ?? t("import.preview.none");
}

export function serverPeerReason(peer: ImportPreviewServerPeer): string {
  return peer.reason ?? t("import.preview.none");
}

export function previewKey(publicKey: string | null): string {
  return publicKey ?? t("import.preview.none");
}

export function changesKey(interfaceId: string, client: { device_id: string | null; name: string }): string {
  return `${interfaceId}:${client.device_id ?? client.name}`;
}

export function clientChangeLabel(field: ImportClientChangeField): string {
  switch (field) {
    case "address":
      return t("import.preview.change.address");
    case "preshared_key":
      return t("import.preview.change.preshared_key");
    case "name":
      return t("import.preview.change.name");
  }
}

export function clientChangeText(change: ImportClientChange): string {
  const from = changeValue(change.field, change.from);
  const to = changeValue(change.field, change.to);
  return `${from} → ${to}`;
}

function changeValue(field: ImportClientChangeField, value: string | null): string {
  if (field === "preshared_key") {
    return value === null ? t("import.preview.none") : PRESHARED_KEY_MASK;
  }
  return value ?? t("import.preview.none");
}

function poolName(
  interfaces: readonly InterfaceDraft[],
  interfaceIndex: number,
  poolIndex: number,
): string {
  return interfaces[interfaceIndex]?.pools[poolIndex]?.name.trim() ?? "";
}

function poolLabel(
  interfaces: readonly InterfaceDraft[],
  interfaceIndex: number,
  poolIndex: number,
): string {
  const name = poolName(interfaces, interfaceIndex, poolIndex);
  return name.length > 0 ? name : `#${poolIndex + 1}`;
}
