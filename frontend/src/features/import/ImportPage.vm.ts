import { ViewModel, computed, reactive, watch } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import type { ImportService } from "@/application/import/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { NodesService } from "@/application/nodes/service";
import type { UsersService } from "@/application/users/service";
import type {
  ClientsApplyResult,
  ClientsImportInput,
  ClientsPreview,
  ClientsPreviewInterface,
  ImportApplyResult,
  ImportClientChange,
  ImportClientChangeField,
  ImportClientStatus,
  ImportInput,
  ImportPreview,
  ImportPreviewClient,
  ImportPreviewInterface,
  ImportPreviewServerPeer,
  ImportServerPeerCounts,
  ImportServerPeerStatus,
} from "@/domain/import/types";
import {
  extractClientAddress,
  extractPeerPublicKey,
  isServerConfig,
  splitClientConfigs,
  validateImportInput,
  type ImportGroupIssue,
  type ImportInterfaceIssue,
  type ImportValidation,
} from "@/domain/import/validation";
import type { InterfaceInfo, NodeInfo, PoolMode, User } from "@/domain/types";
import { t } from "@/i18n";

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

const DEFAULT_BASE_CIDR = "10.8.0.0/24";
const DEFAULT_PORT = 51820;
const DEFAULT_MTU = 1280;
const MAX_IMPORT_FILES = 50;
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_FILE_LABEL = "2 МБ";

const DEFAULT_STEP: ImportStep = 1;

const EMPTY_SERVER_PEER_COUNTS: ImportServerPeerCounts = {
  create: 0,
  duplicate: 0,
  error: 0,
};

const SHORT_KEY_PREFIX = 8;
const SHORT_KEY_SUFFIX = 4;
const PRESHARED_KEY_MASK = "•••";

function defaultPool(baseCidr: string): PoolDraft {
  return {
    name: "default",
    cidr: baseCidr || DEFAULT_BASE_CIDR,
    mode: "auto",
    gateway: "",
  };
}

function createInterface(name: string, baseCidr: string): InterfaceDraft {
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

function validateFiles(files: readonly File[]): string | null {
  if (files.length > MAX_IMPORT_FILES) {
    return t("import.error.tooManyFiles", { max: MAX_IMPORT_FILES });
  }
  const oversized = files.find((file) => file.size > MAX_IMPORT_FILE_BYTES);
  if (oversized !== undefined) {
    return t("import.error.fileTooLarge", {
      name: oversized.name,
      max: MAX_IMPORT_FILE_LABEL,
    });
  }
  return null;
}

function readFileAsText(file: File): Promise<string> {
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

function uniqueName(base: string, used: Set<string>): string {
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

function buildClientDrafts(text: string): ClientDraft[] {
  const used = new Set<string>();
  return splitClientConfigs(text).map((config, index) => ({
    name: uniqueName(`client-${index + 1}`, used),
    config,
  }));
}

async function readClientFileDrafts(files: File[], used: Set<string>): Promise<ClientDraft[]> {
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function isPoolIssue(issue: ImportInterfaceIssue, poolIndex: number): boolean {
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

export class ImportVM extends ViewModel {
  @reactive accessor mode: ImportMode = "group";
  @reactive accessor step: ImportStep = DEFAULT_STEP;
  @reactive accessor groupName = "";
  @reactive accessor groupDescription = "";
  @reactive accessor baseCidr = DEFAULT_BASE_CIDR;
  @reactive accessor nodeId = "";
  @reactive accessor ownerUserId = "";
  @reactive accessor interfaces: InterfaceDraft[] = [createInterface("awg0", DEFAULT_BASE_CIDR)];

  @reactive accessor clientsStep: ClientsStep = 1;
  @reactive accessor clientOwnerUserId = "";
  @reactive accessor clientInterfaceId = "";
  @reactive accessor clientsImportText = "";
  @reactive accessor clientsImport: ClientDraft[] = [];
  @reactive accessor clientsPreviewing = false;
  @reactive accessor clientsPreview: ClientsPreview | null = null;
  @reactive accessor clientsPreviewError: string | null = null;
  @reactive accessor clientsPlanInvalidated = false;
  @reactive accessor clientsApplying = false;
  @reactive accessor clientsApplied: ClientsApplyResult | null = null;
  @reactive accessor clientsApplyError: string | null = null;
  @reactive accessor expandedChanges: string[] = [];

  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor nodesLoading = false;
  @reactive accessor nodesError: string | null = null;
  @reactive accessor owners: User[] = [];
  @reactive accessor ownersLoading = false;
  @reactive accessor ownersError: string | null = null;
  @reactive accessor interfaceList: InterfaceInfo[] = [];
  @reactive accessor interfacesLoading = false;
  @reactive accessor interfacesError: string | null = null;

  @reactive accessor previewing = false;
  @reactive accessor preview: ImportPreview | null = null;
  @reactive accessor previewError: string | null = null;
  @reactive accessor planInvalidated = false;
  @reactive accessor applying = false;
  @reactive accessor applied: ImportApplyResult | null = null;
  @reactive accessor applyError: string | null = null;

  private previewSignature = "";
  private clientsPreviewSignature = "";

  constructor(
    private readonly importService: ImportService,
    private readonly nodesService: NodesService,
    private readonly usersService: UsersService,
    private readonly interfacesService: InterfacesService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
  }

  override async created(): Promise<void> {
    await Promise.all([this.loadNodes(), this.loadOwners(), this.loadInterfaces()]);
    if (!this.nodeId) {
      this.nodeId = this.nodes.find((node) => node.online)?.id ?? this.nodes[0]?.id ?? "";
    }
  }

  @computed
  get nodeName(): string {
    return this.nodes.find((node) => node.id === this.nodeId)?.name ?? "";
  }

  @computed
  get nodeOptions(): Array<{ value: string; label: string }> {
    return this.nodes.map((node) => ({
      value: node.id,
      label: `${node.name} · ${node.online ? "online" : "offline"}`,
    }));
  }

  @computed
  get ownerOptions(): Array<{ value: string; label: string }> {
    const options = [{ value: "", label: t("import.owner.none") }];
    for (const user of this.owners) {
      options.push({
        value: user.id,
        label: user.email ?? user.login,
      });
    }
    return options;
  }

  @computed
  get interfaceOptions(): Array<{ value: string; label: string }> {
    const options = [{ value: "", label: t("import.clients.interfaceAuto") }];
    for (const iface of this.interfaceList) {
      options.push({
        value: iface.id,
        label: `${iface.name} · ${iface.group_name} · ${iface.node_name}`,
      });
    }
    return options;
  }

  @computed
  get clientsPayload(): ClientsImportInput {
    return {
      interface_id: this.clientInterfaceId || null,
      owner_user_id: this.clientOwnerUserId || null,
      clients: this.clientsImport.map((client) => ({
        name: client.name.trim(),
        config: client.config,
      })),
    };
  }

  @computed
  get clientsValid(): boolean {
    return (
      this.clientsImport.length > 0 &&
      this.clientsImport.every(
        (client) => client.name.trim().length > 0 && client.config.trim().length > 0,
      )
    );
  }

  @computed
  get clientsTotal(): number {
    return this.clientsImport.length;
  }

  @computed
  get canPreviewClients(): boolean {
    return this.clientsValid && !this.clientsPreviewing;
  }

  @computed
  get canApplyClients(): boolean {
    return this.clientsPreview !== null && !this.clientsApplying;
  }

  @computed
  get clientsFormSignature(): string {
    return JSON.stringify({
      payload: this.clientsPayload,
      text: this.clientsImportText,
    });
  }

  @computed
  get clientsPreviewSummary(): ClientsPreview["summary"] | null {
    return this.clientsPreview?.summary ?? null;
  }

  @computed
  get clientsPreviewInterfaces(): ClientsPreviewInterface[] {
    return this.clientsPreview?.interfaces ?? [];
  }

  @computed
  get clientsPreviewWarnings(): string[] {
    return this.clientsPreview?.warnings ?? [];
  }

  @computed
  get clientsResultInterfaces(): ClientsPreviewInterface[] {
    return this.clientsApplied?.interfaces ?? [];
  }

  @computed
  get clientsResultInterfaceCount(): number {
    return this.clientsResultInterfaces.length;
  }

  @computed
  get clientsResultDeviceCount(): number {
    return (this.clientsApplied?.created.interfaces ?? []).reduce(
      (total, item) => total + item.device_ids.length,
      0,
    );
  }

  @computed
  get clientsResultCreatedCount(): number {
    return this.clientsApplied?.summary.create ?? 0;
  }

  @computed
  get clientsResultUpdatedCount(): number {
    return this.clientsApplied?.summary.update ?? 0;
  }

  @computed
  get clientsResultUnchangedCount(): number {
    return this.clientsApplied?.summary.unchanged ?? 0;
  }

  @computed
  get clientsResultDuplicateCount(): number {
    return this.clientsApplied?.summary.duplicate ?? 0;
  }

  @computed
  get clientsResultErrorCount(): number {
    return this.clientsApplied?.summary.error ?? 0;
  }

  @computed
  get clientsResultGroupId(): string {
    return this.clientsResultInterfaces[0]?.group_id ?? "";
  }

  @computed
  get clientsResultGroupPath(): string {
    return this.clientsResultGroupId ? `/groups/${this.clientsResultGroupId}` : "/groups";
  }

  @computed
  get clientsResultFailures(): ClientsResultFailure[] {
    const result = this.clientsApplied;
    if (!result) return [];
    const failures: ClientsResultFailure[] = [];
    for (const iface of result.interfaces) {
      for (const client of iface.clients) {
        if (client.status === "error") {
          failures.push({
            interfaceName: iface.name,
            groupName: iface.group_name,
            clientName: client.name,
            reason: client.reason ?? t("import.preview.none"),
          });
        }
      }
    }
    return failures;
  }

  @computed
  get groupNameError(): string | null {
    return this.groupName.trim() ? null : t("import.error.groupName");
  }

  @computed
  get baseCidrError(): string | null {
    return this.validation.group.some((issue) => issue.code === "base_cidr.invalid")
      ? t("import.error.baseCidr")
      : null;
  }

  @computed
  get nodeError(): string | null {
    return this.nodeId ? null : t("import.error.node");
  }

  @computed
  get groupValid(): boolean {
    return this.groupName.trim().length > 0 && this.baseCidrError === null && this.nodeId.length > 0;
  }

  @computed
  get payload(): ImportInput {
    return {
      node_id: this.nodeId,
      group_name: this.groupName.trim(),
      group_description: this.groupDescription.trim(),
      base_cidr: this.baseCidr.trim(),
      owner_user_id: this.ownerUserId || null,
      interfaces: this.interfaces.map((iface) => ({
        server_config: iface.serverConfig,
        name: iface.name.trim(),
        label: iface.label.trim(),
        endpoint_host: iface.endpointHost.trim(),
        endpoint_port: iface.endpointPort,
        listen_port: iface.listenPort,
        mtu: iface.mtu,
        pools: iface.pools.map((pool) => ({
          name: pool.name.trim(),
          cidr: pool.cidr.trim(),
          mode: pool.mode,
          gateway: pool.gateway.trim() || null,
        })),
        clients: iface.clients.map((client) => ({
          name: client.name.trim(),
          config: client.config,
        })),
      })),
    };
  }

  @computed
  get validation(): ImportValidation {
    return validateImportInput(this.payload);
  }

  @computed
  get groupIssues(): ImportGroupIssue[] {
    return this.validation.group;
  }

  @computed
  get interfaceIssueCount(): number {
    return this.validation.interfaces.reduce((total, issues) => total + issues.length, 0);
  }

  @computed
  get valid(): boolean {
    return this.validation.valid;
  }

  @computed
  get canPreview(): boolean {
    return this.valid && !this.previewing;
  }

  @computed
  get canApply(): boolean {
    return this.preview !== null && !this.applying;
  }

  @computed
  get formSignature(): string {
    return JSON.stringify({
      payload: this.payload,
      separateTexts: this.interfaces.map((iface) => iface.clientsText),
    });
  }

  @computed
  get totalClients(): number {
    return this.interfaces.reduce((total, iface) => total + iface.clients.length, 0);
  }

  @computed
  get totalPoolCount(): number {
    return this.interfaces.reduce((total, iface) => total + iface.pools.length, 0);
  }

  @computed
  get previewWarnings(): string[] {
    return this.preview?.warnings ?? [];
  }

  @computed
  get previewSummary(): ImportPreview["summary"] | null {
    return this.preview?.summary ?? null;
  }

  @computed
  get previewInterfaces(): ImportPreviewInterface[] {
    return this.preview?.interfaces ?? [];
  }

  @computed
  get previewExternalCounts(): ImportServerPeerCounts {
    return this.preview?.summary.external ?? EMPTY_SERVER_PEER_COUNTS;
  }

  @computed
  get previewHasExternal(): boolean {
    return this.previewInterfaces.some((iface) => iface.server_peers.length > 0);
  }

  @computed
  get resultGroupId(): string {
    return this.applied?.created.group_id ?? "";
  }

  @computed
  get resultGroupPath(): string {
    return this.resultGroupId ? `/groups/${this.resultGroupId}` : "/groups";
  }

  @computed
  get resultInterfaces(): ImportApplyResult["created"]["interfaces"] {
    return this.applied?.created.interfaces ?? [];
  }

  @computed
  get resultInterfaceCount(): number {
    return this.resultInterfaces.length;
  }

  @computed
  get resultDeviceCount(): number {
    return this.resultInterfaces.reduce((total, item) => total + item.device_ids.length, 0);
  }

  @computed
  get resultFailures(): ImportResultFailure[] {
    const result = this.applied;
    if (!result) return [];
    const failures: ImportResultFailure[] = [];
    for (const iface of result.interfaces) {
      for (const client of iface.clients) {
        if (client.status === "error") {
          failures.push({
            interfaceName: iface.name,
            clientName: client.name,
            reason: client.reason ?? t("import.preview.none"),
          });
        }
      }
    }
    return failures;
  }

  @computed
  get resultDuplicateCount(): number {
    return this.applied?.summary.duplicate ?? 0;
  }

  @computed
  get resultCreatedCount(): number {
    return this.applied?.summary.create ?? 0;
  }

  @computed
  get resultErrorCount(): number {
    return this.applied?.summary.error ?? 0;
  }

  @computed
  get resultExternalCount(): number {
    return this.applied?.summary.external.create ?? 0;
  }

  isStepDone(step: ImportStep): boolean {
    switch (step) {
      case 1:
        return this.groupValid;
      case 2:
        return this.valid;
      case 3:
        return this.preview !== null;
      case 4:
        return this.applied !== null;
    }
  }

  goToStep(step: ImportStep): void {
    if (step === this.step) return;
    if (step < this.step) {
      this.step = step;
      return;
    }
    if (step === 2 && this.groupValid) {
      this.step = 2;
      return;
    }
    if (step === 3 && this.preview) {
      this.step = 3;
      return;
    }
    if (step === 3 && this.canPreview) {
      void this.previewNow();
      return;
    }
    if (step === 4 && this.applied) {
      this.step = 4;
    }
  }

  next(): void {
    switch (this.step) {
      case 1:
        if (this.groupValid) this.step = 2;
        else this.toasts.error(t("import.toast.fillRequired"));
        return;
      case 2:
        if (this.canPreview) void this.previewNow();
        else this.toasts.error(t("import.toast.fillRequired"));
        return;
      case 3:
        if (this.canApply) void this.applyNow();
        return;
      case 4:
        return;
    }
  }

  back(): void {
    if (this.step === 1) return;
    this.step = (this.step - 1) as ImportStep;
  }

  async loadNodes(): Promise<void> {
    this.nodesLoading = true;
    this.nodesError = null;
    try {
      this.nodes = await this.nodesService.listNodes();
    } catch (error) {
      this.nodesError = messageOf(error, t("import.error.nodesLoad"));
      this.toasts.error(this.nodesError);
    } finally {
      this.nodesLoading = false;
    }
  }

  async loadOwners(): Promise<void> {
    this.ownersLoading = true;
    this.ownersError = null;
    try {
      this.owners = await this.usersService.listUsers();
    } catch (error) {
      this.owners = [];
      this.ownersError = messageOf(error, t("import.error.usersLoad"));
      this.toasts.error(this.ownersError);
    } finally {
      this.ownersLoading = false;
    }
  }

  async loadInterfaces(): Promise<void> {
    this.interfacesLoading = true;
    this.interfacesError = null;
    try {
      this.interfaceList = await this.interfacesService.listInterfaces();
    } catch (error) {
      this.interfaceList = [];
      this.interfacesError = messageOf(error, t("import.clients.error.interfaces"));
      this.toasts.error(this.interfacesError);
    } finally {
      this.interfacesLoading = false;
    }
  }

  setGroupName(event: Event): void {
    this.groupName = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setGroupDescription(event: Event): void {
    this.groupDescription = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setBaseCidr(event: Event): void {
    this.baseCidr = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setNode(value: string): void {
    this.nodeId = value;
    this.touch();
  }

  setOwner(value: string): void {
    this.ownerUserId = value;
    this.touch();
  }

  addInterface(): void {
    const name = this.nextInterfaceName();
    this.interfaces.push(createInterface(name, this.baseCidr.trim() || DEFAULT_BASE_CIDR));
    this.touch();
  }

  removeInterface(index: number): void {
    if (this.interfaces.length <= 1) return;
    this.interfaces.splice(index, 1);
    this.touch();
  }

  setInterfaceServerConfig(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.serverConfig = (event.target as HTMLTextAreaElement).value;
    this.touch();
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
        this.touch();
      }
      this.toasts.success(t("import.toast.serverLoaded", { name: file.name }));
    } catch (error) {
      this.toasts.error(messageOf(error, t("import.toast.readFileFailed")));
    } finally {
      input.value = "";
    }
  }

  setInterfaceName(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.name = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setInterfaceLabel(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.label = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setEndpointHost(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.endpointHost = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setEndpointPort(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.endpointPort = this.toNumber((event.target as HTMLInputElement).value);
    this.touch();
  }

  setListenPort(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.listenPort = this.toNumber((event.target as HTMLInputElement).value);
    this.touch();
  }

  setMtu(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.mtu = this.toNumber((event.target as HTMLInputElement).value);
    this.touch();
  }

  addPool(interfaceIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.pools.push({
      name: `pool-${draft.pools.length + 1}`,
      cidr: this.baseCidr.trim() || DEFAULT_BASE_CIDR,
      mode: "auto",
      gateway: "",
    });
    this.touch();
  }

  removePool(interfaceIndex: number, poolIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.pools.splice(poolIndex, 1);
    this.touch();
  }

  setPoolName(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.name = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setPoolCidr(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.cidr = (event.target as HTMLInputElement).value;
    this.touch();
  }

  setPoolMode(interfaceIndex: number, poolIndex: number, value: string): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool || (value !== "auto" && value !== "rf_only" && value !== "external_only")) return;
    pool.mode = value;
    this.touch();
  }

  setPoolGateway(interfaceIndex: number, poolIndex: number, event: Event): void {
    const pool = this.interfaces[interfaceIndex]?.pools[poolIndex];
    if (!pool) return;
    pool.gateway = (event.target as HTMLInputElement).value;
    this.touch();
  }

  poolError(interfaceIndex: number, poolIndex: number): string | null {
    const issue = this.interfaceIssues(interfaceIndex).find((item) => isPoolIssue(item, poolIndex));
    return issue ? this.issueMessage(issue) : null;
  }

  setClientsText(index: number, event: Event): void {
    const draft = this.interfaces[index];
    if (!draft) return;
    draft.clientsText = (event.target as HTMLTextAreaElement).value;
    this.applyClientText(draft);
    this.touch();
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
    this.touch();
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
        this.touch();
      }
    } catch (error) {
      this.toasts.error(messageOf(error, t("import.toast.readFilesFailed")));
    } finally {
      input.value = "";
    }
  }

  setClientName(interfaceIndex: number, clientIndex: number, event: Event): void {
    const client = this.interfaces[interfaceIndex]?.clients[clientIndex];
    if (!client) return;
    client.name = (event.target as HTMLInputElement).value;
    this.touch();
  }

  removeClient(interfaceIndex: number, clientIndex: number): void {
    const draft = this.interfaces[interfaceIndex];
    if (!draft) return;
    draft.clients.splice(clientIndex, 1);
    this.syncClientsText(draft);
    this.touch();
  }

  setMode(value: string): void {
    if (value === "group" || value === "clients") this.mode = value;
  }

  setClientOwner(value: string): void {
    this.clientOwnerUserId = value;
    this.touchClients();
  }

  setClientInterface(value: string): void {
    this.clientInterfaceId = value;
    this.touchClients();
  }

  setClientsImportText(event: Event): void {
    this.clientsImportText = (event.target as HTMLTextAreaElement).value;
    this.clientsImport = buildClientDrafts(this.clientsImportText);
    this.touchClients();
  }

  parseClientsImport(notify = true): number {
    const hasText = this.clientsImportText.trim().length > 0;
    this.clientsImport = buildClientDrafts(this.clientsImportText);
    const count = this.clientsImport.length;
    if (notify) {
      if (count > 0) {
        this.toasts.success(t("import.toast.clientsParsed", { count }));
      } else {
        this.toasts.error(t(hasText ? "import.toast.clientsUnparsed" : "import.toast.clientsEmpty"));
      }
    }
    this.touchClients();
    return count;
  }

  async setClientsImportFiles(event: Event): Promise<void> {
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
      const used = new Set(this.clientsImport.map((client) => client.name));
      const additions = await readClientFileDrafts(files, used);
      this.clientsImport = [...this.clientsImport, ...additions];
      this.syncClientsImportText();
      this.toasts.success(t("import.toast.clientsUploaded", { count: additions.length }));
      this.touchClients();
    } catch (error) {
      this.toasts.error(messageOf(error, t("import.toast.readFilesFailed")));
    } finally {
      input.value = "";
    }
  }

  setClientsImportName(index: number, event: Event): void {
    const client = this.clientsImport[index];
    if (!client) return;
    client.name = (event.target as HTMLInputElement).value;
    this.touchClients();
  }

  removeClientsImport(index: number): void {
    this.clientsImport.splice(index, 1);
    this.syncClientsImportText();
    this.touchClients();
  }

  clientsBack(): void {
    if (this.clientsStep === 1) return;
    this.clientsStep = (this.clientsStep - 1) as ClientsStep;
  }

  clientsNext(): void {
    switch (this.clientsStep) {
      case 1:
        if (this.canPreviewClients) void this.previewClientsNow();
        else this.toasts.error(t("import.clients.error.clients"));
        return;
      case 2:
        if (this.canApplyClients) void this.applyClientsNow();
        return;
      case 3:
        return;
    }
  }

  async previewClientsNow(): Promise<void> {
    if (this.clientsPreviewing) return;
    if (!this.clientsValid) {
      this.toasts.error(t("import.clients.error.clients"));
      return;
    }
    const signature = this.clientsFormSignature;
    const payload = this.clientsPayload;
    this.clientsPreviewing = true;
    this.clientsPreviewError = null;
    this.clientsApplyError = null;
    this.clientsStep = 2;
    try {
      const preview = await this.importService.previewClients(payload);
      if (signature !== this.clientsFormSignature) {
        this.invalidateClientsPlan();
        this.clientsStep = 1;
        return;
      }
      this.clientsPreview = preview;
      this.clientsPreviewSignature = signature;
      this.clientsPlanInvalidated = false;
      const changed = preview.summary.update > 0 || preview.summary.unchanged > 0;
      this.toasts.success(
        t(
          changed ? "import.clients.toast.previewReadyUpdated" : "import.clients.toast.previewReady",
          {
            create: preview.summary.create,
            updated: preview.summary.update,
            unchanged: preview.summary.unchanged,
            duplicate: preview.summary.duplicate,
            error: preview.summary.error,
          },
        ),
      );
    } catch (error) {
      this.clientsPreview = null;
      this.clientsPreviewError = messageOf(error, t("import.clients.error.preview"));
      this.toasts.error(this.clientsPreviewError);
    } finally {
      this.clientsPreviewing = false;
    }
  }

  async applyClientsNow(): Promise<void> {
    if (this.clientsApplying) return;
    if (!this.clientsPreview) {
      this.toasts.error(t("import.clients.toast.previewRequired"));
      return;
    }
    this.clientsApplying = true;
    this.clientsApplyError = null;
    try {
      const result = await this.importService.applyClients(this.clientsPayload);
      this.clientsApplied = result;
      this.clientsStep = 3;
      if (result.summary.error > 0) {
        this.toasts.error(
          t("import.clients.toast.appliedWithErrors", {
            created: result.summary.create,
            failed: result.summary.error,
          }),
        );
      } else {
        const updated = result.summary.update;
        this.toasts.success(
          t(updated > 0 ? "import.clients.toast.appliedUpdated" : "import.clients.toast.applied", {
            count: result.summary.create,
            created: result.summary.create,
            updated,
          }),
        );
      }
    } catch (error) {
      this.clientsApplyError = messageOf(error, t("import.clients.error.apply"));
      this.toasts.error(this.clientsApplyError);
    } finally {
      this.clientsApplying = false;
    }
  }

  openClientsGroup(): void {
    this.router.navigate(this.clientsResultGroupPath);
  }

  resetClientsImport(): void {
    this.clientsStep = 1;
    this.clientOwnerUserId = "";
    this.clientInterfaceId = "";
    this.clientsImportText = "";
    this.clientsImport = [];
    this.clientsPreview = null;
    this.clientsApplied = null;
    this.clientsPreviewError = null;
    this.clientsApplyError = null;
    this.clientsPreviewSignature = "";
    this.clientsPlanInvalidated = false;
    this.expandedChanges = [];
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

  interfaceIssues(index: number): ImportInterfaceIssue[] {
    return this.validation.interfaces[index] ?? [];
  }

  issueMessage(issue: ImportInterfaceIssue): string {
    switch (issue.code) {
      case "server_config.invalid":
        return t("import.error.serverConfig");
      case "interface.name.required":
        return t("import.error.interfaceName");
      case "interface.name.duplicate":
        return t("import.error.interfaceNameDuplicate", {
          name: this.interfaces[issue.interfaceIndex]?.name.trim() ?? "",
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
          name: this.poolName(issue.interfaceIndex, issue.poolIndex),
        });
      case "pool.cidr.invalid":
        return t("import.error.poolCidr");
      case "pool.cidr.outside_base":
        return t("import.error.poolOutsideBase");
      case "pool.overlap":
        return t("import.error.poolOverlap", {
          first: this.poolLabel(issue.interfaceIndex, issue.poolIndex),
          second: this.poolLabel(issue.interfaceIndex, issue.relatedPoolIndex),
        });
      case "client.name.required":
        return t("import.error.clientName");
      case "client.config.required":
        return t("import.error.clientConfig");
    }
  }

  groupIssueMessage(issue: ImportGroupIssue): string {
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

  previewStatusLabel(status: ImportClientStatus): string {
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

  previewStatusClass(status: ImportClientStatus): string {
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

  serverPeerStatusLabel(status: ImportServerPeerStatus): string {
    switch (status) {
      case "create":
        return t("import.preview.status.create");
      case "duplicate":
        return t("import.preview.status.duplicate");
      case "error":
        return t("import.preview.status.error");
    }
  }

  serverPeerStatusClass(status: ImportServerPeerStatus): string {
    switch (status) {
      case "create":
        return "badge badge--green";
      case "duplicate":
        return "badge badge--amber";
      case "error":
        return "badge badge--red";
    }
  }

  shortKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed.length <= SHORT_KEY_PREFIX + SHORT_KEY_SUFFIX) return trimmed;
    return `${trimmed.slice(0, SHORT_KEY_PREFIX)}…${trimmed.slice(-SHORT_KEY_SUFFIX)}`;
  }

  serverPeerAddress(peer: ImportPreviewServerPeer): string {
    return peer.address ?? t("import.preview.none");
  }

  serverPeerReason(peer: ImportPreviewServerPeer): string {
    return peer.reason ?? t("import.preview.none");
  }

  changesKey(interfaceId: string, client: ImportPreviewClient): string {
    return `${interfaceId}:${client.device_id ?? client.name}`;
  }

  changesOpen(key: string): boolean {
    return this.expandedChanges.includes(key);
  }

  toggleChanges(key: string): void {
    this.expandedChanges = this.changesOpen(key)
      ? this.expandedChanges.filter((item) => item !== key)
      : [...this.expandedChanges, key];
  }

  clientChangeLabel(field: ImportClientChangeField): string {
    switch (field) {
      case "address":
        return t("import.preview.change.address");
      case "preshared_key":
        return t("import.preview.change.preshared_key");
      case "name":
        return t("import.preview.change.name");
    }
  }

  clientChangeText(change: ImportClientChange): string {
    const from = this.changeValue(change.field, change.from);
    const to = this.changeValue(change.field, change.to);
    return `${from} → ${to}`;
  }

  private changeValue(field: ImportClientChangeField, value: string | null): string {
    if (field === "preshared_key") {
      return value === null ? t("import.preview.none") : PRESHARED_KEY_MASK;
    }
    return value ?? t("import.preview.none");
  }

  previewKey(iface: ImportPreviewInterface): string {
    return iface.public_key ?? t("import.preview.none");
  }

  previewClientAddress(client: ImportPreviewClient): string {
    return client.address ?? t("import.preview.none");
  }

  previewClientReason(client: ImportPreviewClient): string {
    return client.reason ?? t("import.preview.none");
  }

  async previewNow(): Promise<void> {
    if (this.previewing) return;
    if (!this.valid) {
      this.toasts.error(t("import.toast.fillRequired"));
      return;
    }
    const signature = this.formSignature;
    const payload = this.payload;
    this.previewing = true;
    this.previewError = null;
    this.applyError = null;
    this.step = 3;
    try {
      const preview = await this.importService.preview(payload);
      if (signature !== this.formSignature) {
        this.invalidatePlan();
        this.step = 2;
        return;
      }
      this.preview = preview;
      this.previewSignature = signature;
      this.planInvalidated = false;
      const external = preview.summary.external.create;
      this.toasts.success(
        t(
          external > 0 ? "import.toast.previewReadyExternal" : "import.toast.previewReady",
          {
            create: preview.summary.create,
            duplicate: preview.summary.duplicate,
            error: preview.summary.error,
            external,
          },
        ),
      );
    } catch (error) {
      this.preview = null;
      this.previewError = messageOf(error, t("import.error.preview"));
      this.toasts.error(this.previewError);
    } finally {
      this.previewing = false;
    }
  }

  async applyNow(): Promise<void> {
    if (this.applying) return;
    if (!this.preview) {
      this.toasts.error(t("import.toast.previewRequired"));
      return;
    }
    this.applying = true;
    this.applyError = null;
    try {
      const result = await this.importService.apply(this.payload);
      this.applied = result;
      this.step = 4;
      if (result.summary.error > 0) {
        this.toasts.error(
          t("import.toast.appliedWithErrors", {
            created: result.summary.create,
            failed: result.summary.error,
          }),
        );
      } else {
        const external = result.summary.external.create;
        this.toasts.success(
          t(external > 0 ? "import.toast.appliedExternal" : "import.toast.applied", {
            count: result.summary.create,
            external,
          }),
        );
      }
    } catch (error) {
      this.applyError = messageOf(error, t("import.error.apply"));
      this.toasts.error(this.applyError);
    } finally {
      this.applying = false;
    }
  }

  openGroup(): void {
    this.router.navigate(this.resultGroupPath);
  }

  openInterfaces(): void {
    this.router.navigate("/interfaces");
  }

  openNodes(): void {
    this.router.navigate("/nodes");
  }

  reset(): void {
    this.step = DEFAULT_STEP;
    this.groupName = "";
    this.groupDescription = "";
    this.baseCidr = DEFAULT_BASE_CIDR;
    this.ownerUserId = "";
    this.interfaces = [createInterface("awg0", DEFAULT_BASE_CIDR)];
    this.preview = null;
    this.applied = null;
    this.previewError = null;
    this.applyError = null;
    this.previewSignature = "";
    this.planInvalidated = false;
  }

  @watch((vm: ImportVM) => vm.formSignature)
  onFormChange(): void {
    if (this.preview === null && this.applied === null) return;
    if (this.formSignature === this.previewSignature && this.applied === null) return;
    this.invalidatePlan();
  }

  @watch((vm: ImportVM) => vm.clientsFormSignature)
  onClientsFormChange(): void {
    if (this.clientsPreview === null && this.clientsApplied === null) return;
    if (this.clientsFormSignature === this.clientsPreviewSignature && this.clientsApplied === null) {
      return;
    }
    this.invalidateClientsPlan();
  }

  private invalidatePlan(): void {
    const hadPlan = this.preview !== null || this.applied !== null || this.previewing;
    this.preview = null;
    this.applied = null;
    this.previewError = null;
    this.applyError = null;
    this.previewSignature = "";
    if (hadPlan) {
      this.planInvalidated = true;
      if (this.step > 2) this.step = 2;
    }
  }

  private touch(): void {
    this.invalidatePlan();
  }

  private invalidateClientsPlan(): void {
    const hadPlan =
      this.clientsPreview !== null ||
      this.clientsApplied !== null ||
      this.clientsPreviewing;
    this.clientsPreview = null;
    this.clientsApplied = null;
    this.clientsPreviewError = null;
    this.clientsApplyError = null;
    this.clientsPreviewSignature = "";
    this.expandedChanges = [];
    if (hadPlan) {
      this.clientsPlanInvalidated = true;
      if (this.clientsStep > 1) this.clientsStep = 1;
    }
  }

  private touchClients(): void {
    this.invalidateClientsPlan();
  }

  private syncClientsImportText(): void {
    this.clientsImportText = this.clientsImport.map((client) => client.config).join("\n---\n");
  }

  private applyClientText(draft: InterfaceDraft): number {
    draft.clients = buildClientDrafts(draft.clientsText);
    return draft.clients.length;
  }

  private syncClientsText(draft: InterfaceDraft): void {
    draft.clientsText = draft.clients.map((client) => client.config).join("\n---\n");
  }

  private nextInterfaceName(): string {
    const used = new Set(this.interfaces.map((iface) => iface.name.trim().toLowerCase()));
    let index = this.interfaces.length;
    let candidate = `awg${index}`;
    while (used.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `awg${index}`;
    }
    return candidate;
  }

  private poolName(interfaceIndex: number, poolIndex: number): string {
    return this.interfaces[interfaceIndex]?.pools[poolIndex]?.name.trim() ?? "";
  }

  private poolLabel(interfaceIndex: number, poolIndex: number): string {
    const name = this.poolName(interfaceIndex, poolIndex);
    return name.length > 0 ? name : `#${poolIndex + 1}`;
  }

  private toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
