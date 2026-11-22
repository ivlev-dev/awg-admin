import { ViewModel, computed, reactive, watch } from "@ivlev-dev/silent-core";

import type { ImportService } from "@/application/import/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { NodesService } from "@/application/nodes/service";
import type { UsersService } from "@/application/users/service";
import { askConfirm } from "@/app/confirm";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { markClean, registerUnsaved, unregisterUnsaved } from "@/app/unsaved";
import type { InterfaceInfo, NodeInfo, User } from "@/domain/types";
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
import type {
  ImportGroupIssue,
  ImportInterfaceIssue,
  ImportValidation,
} from "@/domain/import/validation";
import { t } from "@/i18n";

import { ClientsFlow } from "./clients-flow";
import type { ClientsImportForm } from "./clients.form";
import type {
  ClientsResultFailure,
  ClientsStep,
  ClientDraft,
  ImportMode,
  ImportResultFailure,
  ImportStep,
  InterfaceDraft,
  PoolDraft,
} from "./drafts";
import { GroupFlow } from "./group-flow";
import type { GroupImportForm } from "./group.form";
import {
  previewKey,
  previewStatusClass,
  previewStatusLabel,
  serverPeerAddress,
  serverPeerReason,
  serverPeerStatusClass,
  serverPeerStatusLabel,
  shortKey,
} from "./interface-issues";
import { ImportLookups } from "./lookups";

export type {
  ClientsResultFailure,
  ClientsStep,
  ClientDraft,
  ImportMode,
  ImportResultFailure,
  ImportStep,
  InterfaceDraft,
  PoolDraft,
};
export class ImportVM extends ViewModel {
  @reactive accessor mode: ImportMode = "group";

  private readonly lookups: ImportLookups;
  private readonly group: GroupFlow;
  private readonly clients: ClientsFlow;

  constructor(
    importService: ImportService,
    nodesService: NodesService,
    usersService: UsersService,
    interfacesService: InterfacesService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.lookups = new ImportLookups(nodesService, usersService, interfacesService, toasts);
    this.group = new GroupFlow(
      importService,
      router,
      toasts,
      () => this.lookups.defaultNodeId(),
    );
    this.clients = new ClientsFlow(importService, router, toasts);
  }

  override async created(): Promise<void> {
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    registerUnsaved("import", () => this.hasDraft);
    await this.lookups.loadNodes();
    if (!this.group.nodeId) {
      this.group.nodeId = this.lookups.defaultNodeId();
    }
    await Promise.all([
      this.lookups.loadOwners(),
      this.lookups.loadInterfaces(),
    ]);
  }

  override dispose(): void {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    unregisterUnsaved("import");
    this.group.dispose();
    this.clients.dispose();
    super.dispose();
  }

  private readonly handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.hasDraft) return;
    event.preventDefault();
    event.returnValue = "";
  };

  @computed
  get hasDraft(): boolean {
    if (this.applied !== null) return false;
    if (this.clientsApplied !== null) return false;
    if (this.mode === "clients") {
      return (
        this.clientsImportText.trim().length > 0 ||
        this.clientsImport.length > 0 ||
        this.clientOwnerUserId.length > 0 ||
        this.clientInterfaceId.length > 0
      );
    }
    if (this.groupName.trim().length > 0) return true;
    if (this.groupDescription.trim().length > 0) return true;
    if (this.ownerUserId.length > 0) return true;
    if (this.preview !== null) return true;
    return this.interfaces.some(
      (iface) =>
        iface.serverConfig.trim().length > 0 ||
        iface.clientsText.trim().length > 0 ||
        iface.clients.length > 0,
    );
  }

  get nodes(): NodeInfo[] { return this.lookups.nodes; }

  get nodesLoading(): boolean { return this.lookups.nodesLoading; }

  get nodesError(): string | null { return this.lookups.nodesError; }

  get owners(): User[] { return this.lookups.owners; }

  get ownersLoading(): boolean { return this.lookups.ownersLoading; }

  get ownersError(): string | null { return this.lookups.ownersError; }

  get interfaceList(): InterfaceInfo[] { return this.lookups.interfaceList; }

  get interfacesLoading(): boolean { return this.lookups.interfacesLoading; }

  get interfacesError(): string | null { return this.lookups.interfacesError; }

  @computed
  get nodeName(): string {
    return this.lookups.nodes.find((node) => node.id === this.group.nodeId)?.name ?? "";
  }

  @computed
  get nodeOptions(): Array<{ value: string; label: string }> { return this.lookups.nodeOptions; }

  @computed
  get ownerOptions(): Array<{ value: string; label: string }> { return this.lookups.ownerOptions; }

  @computed
  get interfaceOptions(): Array<{ value: string; label: string }> { return this.lookups.interfaceOptions; }

  get step(): ImportStep { return this.group.step; }
  set step(value: ImportStep) { this.group.step = value; }

  get groupForm(): GroupImportForm { return this.group.form; }

  get clientsForm(): ClientsImportForm { return this.clients.form; }

  get groupName(): string { return this.group.groupName; }
  set groupName(value: string) { this.group.groupName = value; }

  get groupDescription(): string { return this.group.groupDescription; }
  set groupDescription(value: string) { this.group.groupDescription = value; }

  get baseCidr(): string { return this.group.baseCidr; }
  set baseCidr(value: string) { this.group.baseCidr = value; }

  get nodeId(): string {
    return this.group.nodeId;
  }
  set nodeId(value: string) { this.group.nodeId = value; }

  get ownerUserId(): string { return this.group.ownerUserId; }
  set ownerUserId(value: string) { this.group.ownerUserId = value; }

  get interfaces(): InterfaceDraft[] { return this.group.interfaces; }
  set interfaces(value: InterfaceDraft[]) { this.group.interfaces = value; }

  get previewing(): boolean { return this.group.previewing; }
  set previewing(value: boolean) { this.group.previewing = value; }

  get preview(): ImportPreview | null { return this.group.preview; }
  set preview(value: ImportPreview | null) { this.group.preview = value; }

  get previewError(): string | null { return this.group.previewError; }
  set previewError(value: string | null) { this.group.previewError = value; }

  get planInvalidated(): boolean { return this.group.planInvalidated; }
  set planInvalidated(value: boolean) { this.group.planInvalidated = value; }

  get applying(): boolean { return this.group.applying; }
  set applying(value: boolean) { this.group.applying = value; }

  get applied(): ImportApplyResult | null { return this.group.applied; }
  set applied(value: ImportApplyResult | null) { this.group.applied = value; }

  get applyError(): string | null { return this.group.applyError; }
  set applyError(value: string | null) { this.group.applyError = value; }

  get clientsStep(): ClientsStep { return this.clients.clientsStep; }
  set clientsStep(value: ClientsStep) { this.clients.clientsStep = value; }

  get clientOwnerUserId(): string { return this.clients.clientOwnerUserId; }
  set clientOwnerUserId(value: string) { this.clients.clientOwnerUserId = value; }

  get clientInterfaceId(): string { return this.clients.clientInterfaceId; }
  set clientInterfaceId(value: string) { this.clients.clientInterfaceId = value; }

  get clientsImportText(): string { return this.clients.clientsImportText; }
  set clientsImportText(value: string) { this.clients.clientsImportText = value; }

  get clientsImport(): ClientDraft[] { return this.clients.clientsImport; }
  set clientsImport(value: ClientDraft[]) { this.clients.clientsImport = value; }

  get clientsPreviewing(): boolean { return this.clients.clientsPreviewing; }
  set clientsPreviewing(value: boolean) { this.clients.clientsPreviewing = value; }

  get clientsPreview(): ClientsPreview | null { return this.clients.clientsPreview; }
  set clientsPreview(value: ClientsPreview | null) { this.clients.clientsPreview = value; }

  get clientsPreviewError(): string | null { return this.clients.clientsPreviewError; }
  set clientsPreviewError(value: string | null) { this.clients.clientsPreviewError = value; }

  get clientsPlanInvalidated(): boolean { return this.clients.clientsPlanInvalidated; }
  set clientsPlanInvalidated(value: boolean) { this.clients.clientsPlanInvalidated = value; }

  get clientsApplying(): boolean { return this.clients.clientsApplying; }
  set clientsApplying(value: boolean) { this.clients.clientsApplying = value; }

  get clientsApplied(): ClientsApplyResult | null { return this.clients.clientsApplied; }
  set clientsApplied(value: ClientsApplyResult | null) { this.clients.clientsApplied = value; }

  get clientsApplyError(): string | null { return this.clients.clientsApplyError; }
  set clientsApplyError(value: string | null) { this.clients.clientsApplyError = value; }

  get expandedChanges(): string[] { return this.clients.expandedChanges; }
  set expandedChanges(value: string[]) { this.clients.expandedChanges = value; }

  @computed
  get clientsPayload(): ClientsImportInput { return this.clients.clientsPayload; }

  @computed
  get clientsValid(): boolean { return this.clients.clientsValid; }

  @computed
  get clientsTotal(): number { return this.clients.clientsTotal; }

  @computed
  get canPreviewClients(): boolean { return this.clients.canPreviewClients; }

  @computed
  get canApplyClients(): boolean { return this.clients.canApplyClients; }

  @computed
  get clientsFormSignature(): string { return this.clients.clientsFormSignature; }

  @computed
  get clientsPreviewSummary(): ClientsPreview["summary"] | null {
    return this.clients.clientsPreviewSummary;
  }

  @computed
  get clientsPreviewInterfaces(): ClientsPreviewInterface[] {
    return this.clients.clientsPreviewInterfaces;
  }

  @computed
  get clientsPreviewWarnings(): string[] { return this.clients.clientsPreviewWarnings; }

  @computed
  get clientsResultInterfaces(): ClientsPreviewInterface[] {
    return this.clients.clientsResultInterfaces;
  }

  @computed
  get clientsResultInterfaceCount(): number { return this.clients.clientsResultInterfaceCount; }

  @computed
  get clientsResultDeviceCount(): number { return this.clients.clientsResultDeviceCount; }

  @computed
  get clientsResultCreatedCount(): number { return this.clients.clientsResultCreatedCount; }

  @computed
  get clientsResultUpdatedCount(): number { return this.clients.clientsResultUpdatedCount; }

  @computed
  get clientsResultUnchangedCount(): number { return this.clients.clientsResultUnchangedCount; }

  @computed
  get clientsResultDuplicateCount(): number { return this.clients.clientsResultDuplicateCount; }

  @computed
  get clientsResultErrorCount(): number { return this.clients.clientsResultErrorCount; }

  @computed
  get clientsResultGroupId(): string { return this.clients.clientsResultGroupId; }

  @computed
  get clientsResultGroupPath(): string { return this.clients.clientsResultGroupPath; }

  @computed
  get clientsResultFailures(): ClientsResultFailure[] { return this.clients.clientsResultFailures; }

  @computed
  get groupNameError(): string | null { return this.group.groupNameError; }

  @computed
  get baseCidrError(): string | null { return this.group.baseCidrError; }

  @computed
  get nodeError(): string | null { return this.group.nodeError; }

  @computed
  get groupValid(): boolean { return this.group.groupValid; }

  @computed
  get payload(): ImportInput { return this.group.payload; }

  @computed
  get validation(): ImportValidation { return this.group.validation; }

  @computed
  get groupIssues(): ImportGroupIssue[] { return this.group.groupIssues; }

  @computed
  get interfaceIssueCount(): number { return this.group.interfaceIssueCount; }

  @computed
  get valid(): boolean { return this.group.valid; }

  @computed
  get canPreview(): boolean { return this.group.canPreview; }

  @computed
  get canApply(): boolean { return this.group.canApply; }

  @computed
  get formSignature(): string { return this.group.formSignature; }

  @computed
  get totalClients(): number { return this.group.totalClients; }

  @computed
  get totalPoolCount(): number { return this.group.totalPoolCount; }

  @computed
  get previewWarnings(): string[] { return this.group.previewWarnings; }

  @computed
  get previewSummary(): ImportPreview["summary"] | null { return this.group.previewSummary; }

  @computed
  get previewInterfaces(): ImportPreviewInterface[] { return this.group.previewInterfaces; }

  @computed
  get previewExternalCounts(): ImportServerPeerCounts { return this.group.previewExternalCounts; }

  @computed
  get previewHasExternal(): boolean { return this.group.previewHasExternal; }

  @computed
  get resultGroupId(): string { return this.group.resultGroupId; }

  @computed
  get resultGroupPath(): string { return this.group.resultGroupPath; }

  @computed
  get resultInterfaces(): ImportApplyResult["created"]["interfaces"] {
    return this.group.resultInterfaces;
  }

  @computed
  get resultInterfaceCount(): number { return this.group.resultInterfaceCount; }

  @computed
  get resultDeviceCount(): number { return this.group.resultDeviceCount; }

  @computed
  get resultFailures(): ImportResultFailure[] { return this.group.resultFailures; }

  @computed
  get resultDuplicateCount(): number { return this.group.resultDuplicateCount; }

  @computed
  get resultCreatedCount(): number { return this.group.resultCreatedCount; }

  @computed
  get resultErrorCount(): number { return this.group.resultErrorCount; }

  @computed
  get resultExternalCount(): number { return this.group.resultExternalCount; }

  isStepDone(step: ImportStep): boolean { return this.group.isStepDone(step); }

  goToStep(step: ImportStep): void { this.group.goToStep(step); }

  next(): void { this.group.next(); }

  back(): void { this.group.back(); }

  loadNodes(): Promise<void> { return this.lookups.loadNodes(); }

  loadOwners(): Promise<void> { return this.lookups.loadOwners(); }

  loadInterfaces(): Promise<void> { return this.lookups.loadInterfaces(); }

  setGroupName(event: Event): void { this.group.setGroupName(event); }

  setGroupDescription(event: Event): void { this.group.setGroupDescription(event); }

  setBaseCidr(event: Event): void { this.group.setBaseCidr(event); }

  normalizeBaseCidr(): void { this.group.normalizeBaseCidr(); }

  setNode(value: string): void { this.group.setNode(value); }

  setOwner(value: string): void { this.group.setOwner(value); }

  addInterface(): void { this.group.addInterface(); }

  removeInterface(index: number): void { this.group.removeInterface(index); }

  setInterfaceServerConfig(index: number, event: Event): void {
    this.group.setInterfaceServerConfig(index, event);
  }

  setInterfaceServerFile(index: number, event: Event): Promise<void> {
    return this.group.setInterfaceServerFile(index, event);
  }

  setInterfaceName(index: number, event: Event): void { this.group.setInterfaceName(index, event); }

  setInterfaceLabel(index: number, event: Event): void { this.group.setInterfaceLabel(index, event); }

  setEndpointHost(index: number, event: Event): void { this.group.setEndpointHost(index, event); }

  setEndpointPort(index: number, event: Event): void { this.group.setEndpointPort(index, event); }

  setListenPort(index: number, event: Event): void { this.group.setListenPort(index, event); }

  setMtu(index: number, event: Event): void { this.group.setMtu(index, event); }

  addPool(interfaceIndex: number): void { this.group.addPool(interfaceIndex); }

  removePool(interfaceIndex: number, poolIndex: number): void {
    this.group.removePool(interfaceIndex, poolIndex);
  }

  setPoolName(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.group.setPoolName(interfaceIndex, poolIndex, event);
  }

  setPoolCidr(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.group.setPoolCidr(interfaceIndex, poolIndex, event);
  }

  setPoolMode(interfaceIndex: number, poolIndex: number, value: string): void {
    this.group.setPoolMode(interfaceIndex, poolIndex, value);
  }

  setPoolGateway(interfaceIndex: number, poolIndex: number, event: Event): void {
    this.group.setPoolGateway(interfaceIndex, poolIndex, event);
  }

  poolError(interfaceIndex: number, poolIndex: number): string | null {
    return this.group.poolError(interfaceIndex, poolIndex);
  }

  setClientsText(index: number, event: Event): void { this.group.setClientsText(index, event); }

  parseClients(index: number, notify = true): number { return this.group.parseClients(index, notify); }

  setClientFiles(index: number, event: Event): Promise<void> {
    return this.group.setClientFiles(index, event);
  }

  setClientName(interfaceIndex: number, clientIndex: number, event: Event): void {
    this.group.setClientName(interfaceIndex, clientIndex, event);
  }

  removeClient(interfaceIndex: number, clientIndex: number): void {
    this.group.removeClient(interfaceIndex, clientIndex);
  }

  setMode(value: string): void {
    if (value === "group" || value === "clients") this.mode = value;
  }

  setClientOwner(value: string): void { this.clients.setClientOwner(value); }

  setClientInterface(value: string): void { this.clients.setClientInterface(value); }

  setClientsImportText(event: Event): void { this.clients.setClientsImportText(event); }

  parseClientsImport(notify = true): number { return this.clients.parseClientsImport(notify); }

  setClientsImportFiles(event: Event): Promise<void> {
    return this.clients.setClientsImportFiles(event);
  }

  setClientsImportName(index: number, event: Event): void {
    this.clients.setClientsImportName(index, event);
  }

  removeClientsImport(index: number): void { this.clients.removeClientsImport(index); }

  clientsBack(): void { this.clients.clientsBack(); }

  clientsNext(): void { this.clients.clientsNext(); }

  previewClientsNow(): Promise<void> { return this.clients.previewClientsNow(); }

  applyClientsNow(): Promise<void> {
    return this.clients.applyClientsNow().then(() => markClean("import"));
  }

  openClientsGroup(): void { this.clients.openClientsGroup(); }

  resetClientsImport(): void { this.clients.resetClientsImport(); }

  serverConfigValid(index: number): boolean { return this.group.serverConfigValid(index); }

  serverConfigWarning(index: number): string | null { return this.group.serverConfigWarning(index); }

  interfaceIssues(index: number): ImportInterfaceIssue[] { return this.group.interfaceIssues(index); }

  issueMessage(issue: ImportInterfaceIssue): string { return this.group.issueMessage(issue); }

  groupIssueMessage(issue: ImportGroupIssue): string { return this.group.groupIssueMessage(issue); }

  clientAddress(config: string): string { return this.group.clientAddress(config); }

  clientPeerKey(config: string): string | null { return this.group.clientPeerKey(config); }

  clientPreview(config: string): string { return this.group.clientPreview(config); }

  clientKeysMismatch(interfaceIndex: number): boolean {
    return this.group.clientKeysMismatch(interfaceIndex);
  }

  clientsWithoutKey(interfaceIndex: number): number {
    return this.group.clientsWithoutKey(interfaceIndex);
  }

  previewStatusLabel(status: ImportClientStatus): string {
    return previewStatusLabel(status);
  }

  previewStatusClass(status: ImportClientStatus): string {
    return previewStatusClass(status);
  }

  serverPeerStatusLabel(status: ImportServerPeerStatus): string {
    return serverPeerStatusLabel(status);
  }

  serverPeerStatusClass(status: ImportServerPeerStatus): string {
    return serverPeerStatusClass(status);
  }

  shortKey(key: string): string { return shortKey(key); }

  serverPeerAddress(peer: ImportPreviewServerPeer): string {
    return serverPeerAddress(peer);
  }

  serverPeerReason(peer: ImportPreviewServerPeer): string {
    return serverPeerReason(peer);
  }

  changesKey(interfaceId: string, client: ImportPreviewClient): string {
    return this.clients.changesKey(interfaceId, client);
  }

  changesOpen(key: string): boolean { return this.clients.changesOpen(key); }

  toggleChanges(key: string): void { this.clients.toggleChanges(key); }

  clientChangeLabel(field: ImportClientChangeField): string {
    return this.clients.clientChangeLabel(field);
  }

  clientChangeText(change: ImportClientChange): string {
    return this.clients.clientChangeText(change);
  }

  previewKey(iface: ImportPreviewInterface): string { return previewKey(iface.public_key); }

  previewClientAddress(client: ImportPreviewClient): string {
    return client.address ?? t("import.preview.none");
  }

  previewClientReason(client: ImportPreviewClient): string {
    return client.reason ?? t("import.preview.none");
  }

  previewNow(): Promise<void> { return this.group.previewNow(); }

  applyNow(): Promise<void> { return this.group.applyNow().then(() => markClean("import")); }

  openGroup(): void { this.group.openGroup(); }

  openInterfaces(): void { this.group.openInterfaces(); }

  openNodes(): void { this.group.openNodes(); }

  async reset(): Promise<void> {
    if (this.hasDraft) {
      const confirmed = await askConfirm({
        title: t("import.reset.title"),
        message: t("import.reset.message"),
        confirmLabel: t("import.reset.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.group.reset();
    markClean("import");
  }

  @watch((vm: ImportVM) => vm.formSignature)
  onFormChange(): void {
    if (this.preview === null && this.applied === null) return;
    if (this.group.planMatches(this.formSignature) && this.applied === null) return;
    this.group.invalidatePlan();
  }

  @watch((vm: ImportVM) => vm.clientsFormSignature)
  onClientsFormChange(): void {
    if (this.clientsPreview === null && this.clientsApplied === null) return;
    if (this.clients.planMatches(this.clientsFormSignature) && this.clientsApplied === null) {
      return;
    }
    this.clients.invalidateClientsPlan();
  }
}
