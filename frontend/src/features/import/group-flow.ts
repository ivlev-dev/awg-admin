import { computed, reactive } from "@ivlev-dev/silent-core";

import { userMessage } from "@/application/errors";
import type { ImportService } from "@/application/import/service";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import type {
  ImportApplyResult,
  ImportInput,
  ImportPreview,
  ImportPreviewInterface,
  ImportServerPeerCounts,
} from "@/domain/import/types";
import {
  validateImportInput,
  type ImportGroupIssue,
  type ImportInterfaceIssue,
  type ImportValidation,
} from "@/domain/import/validation";
import { t } from "@/i18n";

import {
  createInterface,
  DEFAULT_BASE_CIDR,
  DEFAULT_STEP,
  type ImportResultFailure,
  type ImportStep,
  type InterfaceDraft,
} from "./drafts";
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  GroupImportForm,
  isBaseCidr,
} from "./group.form";
import { groupIssueMessage } from "./interface-issues";
import { InterfaceDrafts } from "./interface-drafts";

const EMPTY_SERVER_PEER_COUNTS: ImportServerPeerCounts = {
  create: 0,
  duplicate: 0,
  error: 0,
};

export class GroupFlow {
  private readonly drafts: InterfaceDrafts;

  readonly form = new GroupImportForm();

  constructor(
    private readonly importService: ImportService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
    private readonly defaultNodeId: () => string = () => "",
  ) {
    const self = this;
    this.drafts = new InterfaceDrafts(toasts);
    this.drafts.attach({
      get baseCidr() {
        return self.baseCidr;
      },
      get validation() {
        return self.validation;
      },
      touch: () => self.touch(),
    });
  }

  @reactive accessor step: ImportStep = DEFAULT_STEP;

  get groupName(): string { return this.form.groupName; }
  set groupName(value: string) { this.form.groupName = value; }

  get groupDescription(): string { return this.form.groupDescription; }
  set groupDescription(value: string) { this.form.groupDescription = value; }

  get baseCidr(): string { return this.form.baseCidr; }
  set baseCidr(value: string) { this.form.baseCidr = value; }

  get nodeId(): string { return this.form.nodeId; }
  set nodeId(value: string) { this.form.nodeId = value; }

  get ownerUserId(): string { return this.form.ownerUserId; }
  set ownerUserId(value: string) { this.form.ownerUserId = value; }

  get interfaces(): InterfaceDraft[] { return this.drafts.interfaces; }

  set interfaces(value: InterfaceDraft[]) { this.drafts.interfaces = value; }

  @reactive accessor previewing = false;
  @reactive accessor preview: ImportPreview | null = null;
  @reactive accessor previewError: string | null = null;
  @reactive accessor planInvalidated = false;
  @reactive accessor applying = false;
  @reactive accessor applied: ImportApplyResult | null = null;
  @reactive accessor applyError: string | null = null;

  private previewSignature = "";

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
    return this.groupValid && this.validation.valid;
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

  @computed
  get groupNameError(): string | null {
    return this.groupName.trim() ? null : t("import.error.groupName");
  }

  @computed
  get baseCidrError(): string | null {
    return isBaseCidr(this.baseCidr) ? null : t("import.error.baseCidr");
  }

  @computed
  get nodeError(): string | null {
    return this.nodeId ? null : t("import.error.node");
  }

  @computed
  get groupValid(): boolean {
    return (
      this.groupName.trim().length > 0 &&
      this.groupName.length <= GROUP_NAME_MAX_LENGTH &&
      this.groupDescription.length <= GROUP_DESCRIPTION_MAX_LENGTH &&
      isBaseCidr(this.baseCidr) &&
      this.nodeId.length > 0
    );
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
        else {
          void this.form.validate();
          this.toasts.error(t("import.toast.fillRequired"));
        }
        return;
      case 2:
        if (this.canPreview) void this.previewNow();
        else {
          void this.form.validate();
          this.toasts.error(t("import.toast.fillRequired"));
        }
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

  setGroupName(event: Event): void {
    this.form.getFieldProps("groupName").onInput(event);
    this.touch();
  }

  setGroupDescription(event: Event): void {
    this.form.getFieldProps("groupDescription").onInput(event);
    this.touch();
  }

  setBaseCidr(event: Event): void {
    this.form.getFieldProps("baseCidr").onInput(event);
    this.touch();
  }

  /** Убирает пробелы по краям CIDR, чтобы `@Matches` видел уже нормализованное значение. */
  normalizeBaseCidr(): void {
    const trimmed = this.baseCidr.trim();
    if (trimmed !== this.baseCidr) this.baseCidr = trimmed;
  }

  setNode(value: string): void {
    this.nodeId = value;
    void this.form.validateField("nodeId");
    this.touch();
  }

  setOwner(value: string): void {
    this.ownerUserId = value;
    this.touch();
  }

  addInterface(): void { this.drafts.addInterface(); }

  removeInterface(index: number): void { this.drafts.removeInterface(index); }

  setInterfaceServerConfig(index: number, event: Event): void {
    this.drafts.setInterfaceServerConfig(index, event);
  }

  setInterfaceServerFile(index: number, event: Event): Promise<void> {
    return this.drafts.setInterfaceServerFile(index, event);
  }

  setInterfaceName(index: number, event: Event): void { this.drafts.setInterfaceName(index, event); }

  setInterfaceLabel(index: number, event: Event): void { this.drafts.setInterfaceLabel(index, event); }

  setEndpointHost(index: number, event: Event): void { this.drafts.setEndpointHost(index, event); }

  setEndpointPort(index: number, event: Event): void { this.drafts.setEndpointPort(index, event); }

  setListenPort(index: number, event: Event): void { this.drafts.setListenPort(index, event); }

  setMtu(index: number, event: Event): void { this.drafts.setMtu(index, event); }

  addPool(interfaceIndex: number): void { this.drafts.addPool(interfaceIndex); }

  removePool(interfaceIndex: number, poolIndex: number): void {
    this.drafts.removePool(interfaceIndex, poolIndex);
  }

  setPoolName(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.drafts.setPoolName(interfaceIndex, poolIndex, event);
  }

  setPoolCidr(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.drafts.setPoolCidr(interfaceIndex, poolIndex, event);
  }

  setPoolMode(interfaceIndex: number, poolIndex: number, value: string): void {
    this.drafts.setPoolMode(interfaceIndex, poolIndex, value);
  }

  setPoolGateway(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.drafts.setPoolGateway(interfaceIndex, poolIndex, event);
  }

  poolError(interfaceIndex: number, poolIndex: number): string | null {
    return this.drafts.poolError(interfaceIndex, poolIndex);
  }

  setClientsText(index: number, event: Event): void { this.drafts.setClientsText(index, event); }

  parseClients(index: number, notify = true): number {
    return this.drafts.parseClients(index, notify);
  }

  setClientFiles(index: number, event: Event): Promise<void> {
    return this.drafts.setClientFiles(index, event);
  }

  setClientName(interfaceIndex: number, clientIndex: number, event: Event): void {
    this.drafts.setClientName(interfaceIndex, clientIndex, event);
  }

  removeClient(interfaceIndex: number, clientIndex: number): void {
    this.drafts.removeClient(interfaceIndex, clientIndex);
  }

  serverConfigValid(index: number): boolean { return this.drafts.serverConfigValid(index); }

  serverConfigWarning(index: number): string | null { return this.drafts.serverConfigWarning(index); }

  interfaceIssues(index: number): ImportInterfaceIssue[] { return this.drafts.interfaceIssues(index); }

  issueMessage(issue: ImportInterfaceIssue): string { return this.drafts.issueMessage(issue); }

  groupIssueMessage(issue: ImportGroupIssue): string { return groupIssueMessage(issue); }

  clientAddress(config: string): string { return this.drafts.clientAddress(config); }

  clientPeerKey(config: string): string | null { return this.drafts.clientPeerKey(config); }

  clientPreview(config: string): string { return this.drafts.clientPreview(config); }

  clientKeysMismatch(interfaceIndex: number): boolean {
    return this.drafts.clientKeysMismatch(interfaceIndex);
  }

  clientsWithoutKey(interfaceIndex: number): number {
    return this.drafts.clientsWithoutKey(interfaceIndex);
  }

  async previewNow(): Promise<void> {
    if (this.previewing) return;
    if (!this.nodeId) {
      const fallback = this.defaultNodeId();
      if (fallback.length > 0) this.nodeId = fallback;
    }
    this.normalizeBaseCidr();
    await this.form.validate();
    if (!this.valid) {
      this.toasts.error(t("import.toast.fillRequired"));
      return;
    }
    if (this.previewing) return;
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
      this.previewError = userMessage(error, t("import.error.preview"));
      this.toasts.error(this.previewError);
    } finally {
      this.previewing = false;
    }
  }

  async applyNow(): Promise<void> {
    if (this.applying) return;
    this.normalizeBaseCidr();
    await this.form.validate();
    if (!this.valid) {
      this.toasts.error(t("import.toast.fillRequired"));
      return;
    }
    if (!this.preview) {
      this.toasts.error(t("import.toast.previewRequired"));
      return;
    }
    if (this.applying) return;
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
      this.applyError = userMessage(error, t("import.error.apply"));
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
    const nodeId = this.nodeId;
    this.step = DEFAULT_STEP;
    this.form.reset();
    this.nodeId = nodeId;
    this.interfaces = [createInterface("awg0", DEFAULT_BASE_CIDR)];
    this.preview = null;
    this.applied = null;
    this.previewError = null;
    this.applyError = null;
    this.previewSignature = "";
    this.planInvalidated = false;
  }

  dispose(): void {
    this.form.dispose();
  }

  invalidatePlan(): void {
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

  touch(): void {
    this.invalidatePlan();
  }

  planMatches(signature: string): boolean {
    return signature === this.previewSignature;
  }
}
