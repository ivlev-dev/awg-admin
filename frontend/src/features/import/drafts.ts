import { splitClientConfigs } from "@/domain/import/validation";
import type { PoolMode } from "@/domain/types";
import { t } from "@/i18n";
import { formatBytesI18n } from "@/i18n/format";

export interface PoolDraft {
  name: string;
  cidr: string;
  mode: PoolMode;
  gateway: string;
}

export interface ClientDraft {
  name: string;
  config: string;
}

export interface InterfaceDraft {
  serverConfig: string;
  name: string;
  label: string;
  endpointHost: string;
  endpointPort: number;
  listenPort: number;
  mtu: number;
  pools: PoolDraft[];
  clientsText: string;
  clients: ClientDraft[];
}

export type ImportStep = 1 | 2 | 3 | 4;
export type ImportMode = "group" | "clients";
export type ClientsStep = 1 | 2 | 3;

export interface ImportResultFailure {
  interfaceName: string;
  clientName: string;
  reason: string;
}

export interface ClientsResultFailure extends ImportResultFailure {
  groupName: string;
}

export const DEFAULT_BASE_CIDR = "10.8.0.0/24";
export const DEFAULT_PORT = 51820;
export const DEFAULT_MTU = 1280;
export const DEFAULT_STEP: ImportStep = 1;

const MAX_IMPORT_FILES = 50;
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

function defaultPool(baseCidr: string): PoolDraft {
  return {
    name: "default",
    cidr: baseCidr || DEFAULT_BASE_CIDR,
    mode: "auto",
    gateway: "",
  };
}

export function createInterface(name: string, baseCidr: string): InterfaceDraft {
  return {
    serverConfig: "",
    name,
    label: "",
    endpointHost: "",
    endpointPort: DEFAULT_PORT,
    listenPort: DEFAULT_PORT,
    mtu: DEFAULT_MTU,
    pools: [defaultPool(baseCidr)],
    clientsText: "",
    clients: [],
  };
}

export function validateFiles(files: readonly File[]): string | null {
  if (files.length > MAX_IMPORT_FILES) {
    return t("import.error.tooManyFiles", { max: MAX_IMPORT_FILES });
  }
  const oversized = files.find((file) => file.size > MAX_IMPORT_FILE_BYTES);
  if (oversized !== undefined) {
    return t("import.error.fileTooLarge", {
      name: oversized.name,
      max: formatBytesI18n(MAX_IMPORT_FILE_BYTES, 0),
    });
  }
  return null;
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(t("import.toast.readFileFailed")));
    reader.readAsText(file);
  });
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

export function uniqueName(base: string, used: Set<string>): string {
  const trimmed = base.trim();
  const baseName = trimmed || "client";
  if (!used.has(baseName)) {
    used.add(baseName);
    return baseName;
  }
  let index = 2;
  while (used.has(`${baseName}-${index}`)) index += 1;
  const candidate = `${baseName}-${index}`;
  used.add(candidate);
  return candidate;
}

export function buildClientDrafts(text: string): ClientDraft[] {
  const used = new Set<string>();
  return splitClientConfigs(text).map((config, index) => ({
    name: uniqueName(`client-${index + 1}`, used),
    config,
  }));
}

export async function readClientFileDrafts(
  files: File[],
  used: Set<string>,
): Promise<ClientDraft[]> {
  const loaded = await Promise.all(
    files.map(async (file) => ({
      name: fileBaseName(file.name),
      config: (await readFileAsText(file)).trim(),
    })),
  );
  return loaded
    .filter((item) => item.config.length > 0)
    .map((item, index) => ({
      name: uniqueName(item.name || `client-${used.size + index + 1}`, used),
      config: item.config,
    }));
}

export function joinClientConfigs(clients: readonly ClientDraft[]): string {
  return clients.map((client) => client.config).join("\n---\n");
}

export function nextInterfaceName(interfaces: readonly InterfaceDraft[]): string {
  const used = new Set(interfaces.map((iface) => iface.name.trim().toLowerCase()));
  let index = interfaces.length;
  let candidate = `awg${index}`;
  while (used.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `awg${index}`;
  }
  return candidate;
}
