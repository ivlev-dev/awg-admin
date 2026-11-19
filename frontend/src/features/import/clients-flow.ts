import { computed, reactive } from "@ivlev-dev/silent-core";

import { userMessage } from "@/application/errors";
import type { ImportService } from "@/application/import/service";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import type {
  ClientsApplyResult,
  ClientsImportInput,
  ClientsPreview,
  ClientsPreviewInterface,
  ImportClientChange,
  ImportClientChangeField,
  ImportClientStatus,
  ImportPreviewClient,
} from "@/domain/import/types";
import type { ClientsResultFailure, ClientsStep, ClientDraft } from "./drafts";
import { t } from "@/i18n";

import {
  buildClientDrafts,
  joinClientConfigs,
  readClientFileDrafts,
  validateFiles,
} from "./drafts";
import {
  changesKey,
  clientChangeLabel,
  clientChangeText,
  previewStatusLabel,
} from "./interface-issues";

export class ClientsFlow {
  constructor(
    private readonly importService: ImportService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {}

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

  private clientsPreviewSignature = "";

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
      this.toasts.error(userMessage(error, t("import.toast.readFilesFailed")));
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
      this.clientsPreviewError = userMessage(error, t("import.clients.error.preview"));
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
      this.clientsApplyError = userMessage(error, t("import.clients.error.apply"));
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

  changesKey(interfaceId: string, client: ImportPreviewClient): string {
    return changesKey(interfaceId, client);
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
    return clientChangeLabel(field);
  }

  clientChangeText(change: ImportClientChange): string {
    return clientChangeText(change);
  }

  previewStatusLabel(status: ImportClientStatus): string {
    return previewStatusLabel(status);
  }

  previewClientAddress(client: ImportPreviewClient): string {
    return client.address ?? t("import.preview.none");
  }

  previewClientReason(client: ImportPreviewClient): string {
    return client.reason ?? t("import.preview.none");
  }

  invalidateClientsPlan(): void {
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

  touchClients(): void {
    this.invalidateClientsPlan();
  }

  planMatches(signature: string): boolean {
    return signature === this.clientsPreviewSignature;
  }

  private syncClientsImportText(): void {
    this.clientsImportText = joinClientConfigs(this.clientsImport);
  }
}
