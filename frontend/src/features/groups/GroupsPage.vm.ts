import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import type { GroupsService } from "@/application/groups/service";
import type { Group } from "@/domain/types";
import { isCidr } from "@/domain/validation";
import { t } from "@/i18n";

export class GroupsPageVM {
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

  constructor(
    private readonly groupsService: GroupsService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {}

  created(): void {
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
    } catch (error) {
      this.error = messageOf(error, t("groups.error.load"));
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
  }

  openEdit(group: Group): void {
    this.editing = group;
    this.formName = group.name;
    this.formDescription = group.description;
    this.formBaseCidr = group.base_cidr;
    this.formForwarding = group.forwarding_default;
    this.formError = null;
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
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
      await this.reload();
    } catch (error) {
      this.formError = messageOf(error, t("groups.error.save"));
      this.toasts.error(this.formError);
    } finally {
      this.saving = false;
    }
  }

  async remove(group: Group): Promise<void> {
    if (!window.confirm(t("groups.confirm.delete", { name: group.name }))) return;
    try {
      await this.groupsService.deleteGroup(group.id);
      this.toasts.success(t("groups.toast.deleted", { name: group.name }));
      await this.reload();
    } catch (error) {
      const message = messageOf(error, t("groups.error.delete"));
      this.error = message.toLowerCase().includes("still has interfaces")
        ? t("groups.error.inUse", { name: group.name })
        : message;
      this.toasts.error(this.error);
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}
