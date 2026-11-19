import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import type { GroupsService } from "@/application/groups/service";
import { userMessage } from "@/application/errors";
import type { Group } from "@/domain/types";
import { isCidr } from "@/domain/validation";
import { t } from "@/i18n";

export class GroupsPageVM extends ViewModel {
  @reactive accessor groups: Group[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

  @reactive accessor modalOpen = false;
  @reactive accessor editing: Group | null = null;
  @reactive accessor formName = "";
  @reactive accessor formDescription = "";
  @reactive accessor formBaseCidr = "";
  @reactive accessor formForwarding = false;
  @reactive accessor formError: string | null = null;
  @reactive accessor saving = false;

  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;

  private formSnapshot = "";

  constructor(
    private readonly groupsService: GroupsService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {
    super();
  }

  override created(): void {
    void this.load();
  }

  @computed
  get modalTitle(): string {
    return this.editing ? t("groups.form.title.edit") : t("groups.form.title.new");
  }

  @computed
  get canSave(): boolean {
    return !this.saving && this.formName.trim().length > 0 && this.formBaseCidr.trim().length > 0;
  }

  @computed
  get selectedCount(): number {
    return this.selectedIds.length;
  }

  @computed
  get allSelected(): boolean {
    return this.groups.length > 0 && this.groups.every((group) => this.selectedIds.includes(group.id));
  }

  @computed
  get someSelected(): boolean {
    return this.selectedIds.length > 0 && !this.allSelected;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds = this.isSelected(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id];
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allSelected ? [] : this.groups.map((group) => group.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      await this.reload();
    } finally {
      this.loading = false;
    }
  }

  async reload(): Promise<void> {
    this.error = null;
    try {
      this.groups = await this.groupsService.listGroups();
      const ids = new Set(this.groups.map((group) => group.id));
      this.selectedIds = this.selectedIds.filter((id) => ids.has(id));
    } catch (error) {
      this.error = userMessage(error, t("groups.error.load"));
      this.toasts.error(this.error);
    }
  }

  open(group: Group): void {
    this.router.navigate(`/groups/${group.id}`);
  }

  openCreate(): void {
    this.editing = null;
    this.formName = "";
    this.formDescription = "";
    this.formBaseCidr = "";
    this.formForwarding = false;
    this.formError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  openEdit(group: Group): void {
    this.editing = group;
    this.formName = group.name;
    this.formDescription = group.description;
    this.formBaseCidr = group.base_cidr;
    this.formForwarding = group.forwarding_default;
    this.formError = null;
    this.modalOpen = true;
    this.formSnapshot = this.formState();
  }

  formState(): string {
    return JSON.stringify([
      this.formName,
      this.formDescription,
      this.formBaseCidr,
      this.formForwarding,
    ]);
  }

  @computed
  get formDirty(): boolean {
    return this.modalOpen && this.formState() !== this.formSnapshot;
  }

  async closeModal(): Promise<void> {
    if (this.saving) return;
    if (this.formDirty) {
      const confirmed = await askConfirm({
        title: t("groups.discard.title"),
        message: t("groups.discard.message"),
        confirmLabel: t("groups.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.modalOpen = false;
    this.formError = null;
  }

  setName(event: Event): void {
    this.formName = (event.target as HTMLInputElement).value;
  }

  setDescription(event: Event): void {
    this.formDescription = (event.target as HTMLTextAreaElement).value;
  }

  setBaseCidr(event: Event): void {
    this.formBaseCidr = (event.target as HTMLInputElement).value;
  }

  setForwarding(event: Event): void {
    this.formForwarding = (event.target as HTMLInputElement).checked;
  }

  async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving) return;

    const name = this.formName.trim();
    const baseCidr = this.formBaseCidr.trim();
    if (!name) {
      this.formError = t("groups.error.name");
      return;
    }
    if (!isCidr(baseCidr)) {
      this.formError = t("groups.error.baseCidr");
      return;
    }

    const description = this.formDescription.trim();
    const forwarding = this.formForwarding;
    this.saving = true;
    this.formError = null;
    try {
      if (this.editing) {
        await this.groupsService.updateGroup(this.editing.id, {
          name,
          description,
          base_cidr: baseCidr,
          forwarding_default: forwarding,
        });
        this.toasts.success(t("groups.toast.updated", { name }));
      } else {
        await this.groupsService.createGroup({
          name,
          description,
          base_cidr: baseCidr,
          forwarding_default: forwarding,
        });
        this.toasts.success(t("groups.toast.created", { name }));
      }
      this.modalOpen = false;
      this.formSnapshot = this.formState();
      await this.reload();
    } catch (error) {
      this.formError = userMessage(error, t("groups.error.save"));
      this.toasts.error(this.formError);
    } finally {
      this.saving = false;
    }
  }

  async remove(group: Group): Promise<void> {
    const confirmed = await askConfirm({
      title: t("groups.confirm.delete.title"),
      message: t("groups.confirm.delete", { name: group.name }),
      details: t("groups.confirm.deleteDetails"),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    try {
      await this.groupsService.deleteGroup(group.id);
      this.toasts.success(t("groups.toast.deleted", { name: group.name }));
      await this.reload();
    } catch (error) {
      const message = userMessage(error, t("groups.error.delete"));
      this.error = message.toLowerCase().includes("still has interfaces")
        ? t("groups.error.inUse", { name: group.name })
        : message;
      this.toasts.error(this.error);
    }
  }

  async bulkDelete(): Promise<void> {
    const ids = this.groups
      .filter((group) => this.selectedIds.includes(group.id))
      .map((group) => group.id);
    if (ids.length === 0) return;
    const confirmed = await askConfirm({
      title: t("groups.bulk.delete.title"),
      message: t("groups.bulk.confirm", { count: ids.length }),
      details: t("groups.bulk.confirmDetails"),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;

    this.bulkBusy = true;
    try {
      const result = await this.groupsService.bulk("delete", ids);
      this.toasts[result.failed.length > 0 ? "error" : "success"](
        t("bulk.done", { done: result.done, failed: result.failed.length }),
      );
      await this.reload();
      this.clearSelection();
    } catch (error) {
      this.error = userMessage(error, t("groups.error.delete"));
      this.toasts.error(this.error);
    } finally {
      this.bulkBusy = false;
    }
  }
}

