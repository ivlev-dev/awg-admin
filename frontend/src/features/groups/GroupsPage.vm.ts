import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, router, toasts } from "@/app/container";
import type { Group } from "@/domain/types";
import { isCidr } from "@/domain/validation";

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

  created(): void {
    void this.load();
  }

  @computed
  get modalTitle(): string {
    return this.editing ? "Редактирование группы" : "Новая группа";
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
      this.groups = await api.listGroups();
    } catch (error) {
      this.error = messageOf(error, "Не удалось загрузить группы");
      toasts.error(this.error);
    }
  }

  open(group: Group): void {
    router.navigate(`/groups/${group.id}`);
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
      this.formError = "Укажите название группы";
      return;
    }
    if (!isCidr(baseCidr)) {
      this.formError = "Базовая сеть должна быть в формате CIDR, например 10.8.0.0/16";
      return;
    }

    const description = this.formDescription.trim();
    const forwarding = this.formForwarding;
    this.saving = true;
    this.formError = null;
    try {
      if (this.editing) {
        await api.updateGroup(this.editing.id, {
          name,
          description,
          base_cidr: baseCidr,
          forwarding_default: forwarding,
        });
        toasts.success(`Группа «${name}» обновлена`);
      } else {
        await api.createGroup({
          name,
          description,
          base_cidr: baseCidr,
          forwarding_default: forwarding,
        });
        toasts.success(`Группа «${name}» создана`);
      }
      this.modalOpen = false;
      await this.reload();
    } catch (error) {
      this.formError = messageOf(error, "Не удалось сохранить группу");
      toasts.error(this.formError);
    } finally {
      this.saving = false;
    }
  }

  async remove(group: Group): Promise<void> {
    if (!window.confirm(`Удалить группу «${group.name}»?`)) return;
    try {
      await api.deleteGroup(group.id);
      toasts.success(`Группа «${group.name}» удалена`);
      await this.reload();
    } catch (error) {
      const message = messageOf(error, "Не удалось удалить группу");
      this.error = message.toLowerCase().includes("still has interfaces")
        ? `Группа «${group.name}» содержит интерфейсы — сначала отвяжите их от группы.`
        : message;
      toasts.error(this.error);
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}
