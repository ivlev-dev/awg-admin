import { reactive } from "@ivlev-dev/silent-core";

import { userMessage } from "@/application/errors";
import type { ToastStore } from "@/app/toast";
import {
  extractClientAddress,
  extractPeerPublicKey,
  isServerConfig,
  type ImportInterfaceIssue,
  type ImportValidation,
} from "@/domain/import/validation";
import { t } from "@/i18n";

import {
  buildClientDrafts,
  createInterface,
  DEFAULT_BASE_CIDR,
  joinClientConfigs,
  nextInterfaceName,
  readClientFileDrafts,
  readFileAsText,
  validateFiles,
  type InterfaceDraft,
} from "./drafts";
import { isPoolIssue, issueMessage } from "./interface-issues";

type DraftsHost = {
  readonly baseCidr: string;
  readonly validation: ImportValidation;
  touch(): void;
};

export class InterfaceDrafts {
  private host!: DraftsHost;

  attach(host: DraftsHost): void {
    this.host = host;
  }

  constructor(private readonly toasts: ToastStore) {}

  @reactive accessor interfaces: InterfaceDraft[] = [
    createInterface("awg0", DEFAULT_BASE_CIDR),
  ];

  addInterface(): void {
    const name = nextInterfaceName(this.interfaces);
    this.interfaces.push(createInterface(name, this.host.baseCidr.trim() || DEFAULT_BASE_CIDR));
    this.host.touch();
  }

  removeInterface(index: number): void {
    if (this.interfaces.length <= 1) return;
    this.interfaces.splice(index, 1);
    this.host.touch();
  }

  setInterfaceServerConfig(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.serverConfig = (event.target as HTMLTextAreaElement).value;
    this.host.touch();
  }

  async setInterfaceServerFile(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fileError = validateFiles([file]);
    if (fileError !== null) {
      this.toasts.error(fileError);
      input.value = "";
      return;
    }
    try {
      const config = await readFileAsText(file);
      const draft = this.interfaces[index];
      if (draft) {
        draft.serverConfig = config;
        this.host.touch();
      }
      this.toasts.success(t("import.toast.serverLoaded", { name: file.name }));
    } catch (error) {
      this.toasts.error(userMessage(error, t("import.toast.readFileFailed")));
    } finally {
      input.value = "";
    }
  }

  setInterfaceName(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.name = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  setInterfaceLabel(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.label = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  setEndpointHost(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.endpointHost = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  setEndpointPort(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.endpointPort = toNumber((event.target as HTMLInputElement).value);
    this.host.touch();
  }

  setListenPort(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.listenPort = toNumber((event.target as HTMLInputElement).value);
    this.host.touch();
  }

  setMtu(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.mtu = toNumber((event.target as HTMLInputElement).value);
    this.host.touch();
  }

  addPool(interfaceIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.pools.push({
      name: `pool-${draft.pools.length + 1}`,
      cidr: this.host.baseCidr.trim() || DEFAULT_BASE_CIDR,
      mode: "auto",
      gateway: "",
    });
    this.host.touch();
  }

  removePool(interfaceIndex: number, poolIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.pools.splice(poolIndex, 1);
    this.host.touch();
  }

  setPoolName(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.name = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  setPoolCidr(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.cidr = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  setPoolMode(interfaceIndex: number, poolIndex: number, value: string): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool || (value !== "auto" && value !== "rf_only" && value !== "external_only")) return;
    pool.mode = value;
    this.host.touch();
  }

  setPoolGateway(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.gateway = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  poolError(interfaceIndex: number, poolIndex: number): string | null {
    const issue = this.interfaceIssues(interfaceIndex).find((item) => isPoolIssue(item, poolIndex));
    return issue ? this.issueMessage(issue) : null;
  }

  interfaceIssues(index: number): ImportInterfaceIssue[] {
    return this.host.validation.interfaces[index] ?? [];
  }

  issueMessage(issue: ImportInterfaceIssue): string {
    return issueMessage(issue, this.interfaces);
  }

  setClientsText(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.clientsText = (event.target as HTMLTextAreaElement).value;
    this.applyClientText(draft);
    this.host.touch();
  }

  parseClients(index: number, notify = true): number {
    const draft = this.interfaces[index];
    if (!draft) return 0;
    const hasText = draft.clientsText.trim().length > 0;
    const count = this.applyClientText(draft);
    if (notify) {
      if (count > 0) {
        this.toasts.success(t("import.toast.clientsParsed", { count }));
      } else {
        this.toasts.error(t(hasText ? "import.toast.clientsUnparsed" : "import.toast.clientsEmpty"));
      }
    }
    this.host.touch();
    return count;
  }

  async setClientFiles(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const fileError = validateFiles(files);
    if (fileError !== null) {
      this.toasts.error(fileError);
      input.value = "";
      return;
    }
    try {
      const draft = this.interfaces[index];
      if (draft) {
        const used = new Set(draft.clients.map((client) => client.name));
        const additions = await readClientFileDrafts(files, used);
        draft.clients = [...draft.clients, ...additions];
        this.syncClientsText(draft);
        this.toasts.success(t("import.toast.clientsUploaded", { count: additions.length }));
        this.host.touch();
      }
    } catch (error) {
      this.toasts.error(userMessage(error, t("import.toast.readFilesFailed")));
    } finally {
      input.value = "";
    }
  }

  setClientName(interfaceIndex: number, clientIndex: number, event: Event): void {
    const client = this.interfaces[interfaceIndex]?.clients[clientIndex];
    if (!client) return;
    client.name = (event.target as HTMLInputElement).value;
    this.host.touch();
  }

  removeClient(interfaceIndex: number, clientIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.clients.splice(clientIndex, 1);
    this.syncClientsText(draft);
    this.host.touch();
  }

  serverConfigValid(index: number): boolean {
    const draft = this.interfaces[index];
    return draft ? isServerConfig(draft.serverConfig) : false;
  }

  serverConfigWarning(index: number): string | null {
    const draft = this.interfaces[index];
    if (!draft || !draft.serverConfig.trim() || this.serverConfigValid(index)) return null;
    return t("import.error.serverConfig");
  }

  clientAddress(config: string): string {
    return extractClientAddress(config);
  }

  clientPeerKey(config: string): string | null {
    return extractPeerPublicKey(config);
  }

  clientPreview(config: string): string {
    return config.split("\n").slice(0, 8).join("\n");
  }

  clientKeysMismatch(interfaceIndex: number): boolean {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return false;
    const keys = new Set<string>();
    for (const client of draft.clients) {
      const key = extractPeerPublicKey(client.config);
      if (key) keys.add(key);
    }
    return keys.size > 1;
  }

  clientsWithoutKey(interfaceIndex: number): number {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return 0;
    return draft.clients.filter((client) => extractPeerPublicKey(client.config) === null).length;
  }

  private syncClientsText(draft: InterfaceDraft): void {
    draft.clientsText = joinClientConfigs(draft.clients);
  }

  private applyClientText(draft: InterfaceDraft): number {
    draft.clients = buildClientDrafts(draft.clientsText);
    return draft.clients.length;
  }
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
