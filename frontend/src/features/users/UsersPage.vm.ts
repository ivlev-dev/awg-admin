import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, session, toasts } from "@/app/container";
import type { Group, Role, Tariff, User } from "@/domain/types";

export class UsersPageVM {
  @reactive accessor users: User[] = [];
  @reactive accessor tariffs: Tariff[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

  @reactive accessor modalOpen = false;
  @reactive accessor editingId: string | null = null;
  @reactive accessor saving = false;
  @reactive accessor formError: string | null = null;

  @reactive accessor login = "";
  @reactive accessor password = "";
  @reactive accessor role: Role = "user";
  @reactive accessor tariffId = "";
  @reactive accessor groupId = "";
  @reactive accessor disabled = false;

  @reactive accessor resetOpen = false;
  @reactive accessor resetTarget: User | null = null;
  @reactive accessor resetPassword = "";

  created(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [users, tariffs, groups] = await Promise.all([
        api.listUsers(),
        api.listTariffs(),
        api.listGroups(),
      ]);
      this.users = users;
      this.tariffs = tariffs;
      this.groups = groups;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Не удалось загрузить пользователей";
    } finally {
      this.loading = false;
    }
  }

  @computed
  get title(): string {
    return this.editingId ? "Редактировать пользователя" : "Новый пользователь";
  }

  @computed
  get selfId(): string {
    return session.user?.id ?? "";
  }

  tariffName(id: string | null): string {
    if (!id) return "Не задан";
    return this.tariffs.find((tariff) => tariff.id === id)?.name ?? "—";
  }

  groupName(id: string | null): string {
    if (!id) return "Не задана";
    return this.groups.find((group) => group.id === id)?.name ?? "—";
  }

  openCreate(): void {
    this.editingId = null;
    this.login = "";
    this.password = "";
    this.role = "user";
    this.tariffId = "";
    this.groupId = "";
    this.disabled = false;
    this.formError = null;
    this.modalOpen = true;
  }

  openEdit(user: User): void {
    this.editingId = user.id;
    this.login = user.login;
    this.password = "";
    this.role = user.role;
    this.tariffId = user.tariff_id ?? "";
    this.groupId = user.group_id ?? "";
    this.disabled = user.disabled;
    this.formError = null;
    this.modalOpen = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.modalOpen = false;
  }

  setLogin(event: Event): void {
    this.login = (event.target as HTMLInputElement).value;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  setRole(value: string): void {
    this.role = value === "admin" ? "admin" : "user";
  }

  setTariff(value: string): void {
    this.tariffId = value;
  }

  setGroup(value: string): void {
    this.groupId = value;
  }

  setDisabled(event: Event): void {
    this.disabled = (event.target as HTMLInputElement).checked;
  }

  async submit(): Promise<void> {
    this.saving = true;
    this.formError = null;
    try {
      if (this.editingId) {
        await api.updateUser(this.editingId, {
          role: this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          group_id: this.groupId ? this.groupId : null,
          disabled: this.disabled,
        });
        toasts.success("Пользователь обновлён");
      } else {
        if (this.password.length < 8) {
          this.formError = "Пароль должен быть не короче 8 символов";
          return;
        }
        await api.createUser({
          login: this.login.trim(),
          password: this.password,
          role: this.role,
          tariff_id: this.tariffId ? this.tariffId : null,
          group_id: this.groupId ? this.groupId : null,
        });
        toasts.success("Пользователь создан");
      }
      this.modalOpen = false;
      await this.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить пользователя";
      this.formError = message;
      toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  openReset(user: User): void {
    this.resetTarget = user;
    this.resetPassword = "";
    this.resetOpen = true;
  }

  closeReset(): void {
    this.resetOpen = false;
    this.resetTarget = null;
  }

  setResetPassword(event: Event): void {
    this.resetPassword = (event.target as HTMLInputElement).value;
  }

  async submitReset(): Promise<void> {
    if (!this.resetTarget) return;
    if (this.resetPassword.length < 8) {
      toasts.error("Пароль должен быть не короче 8 символов");
      return;
    }
    try {
      await api.resetPassword(this.resetTarget.id, this.resetPassword);
      toasts.success("Пароль обновлён");
      this.closeReset();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : "Не удалось сбросить пароль");
    }
  }

  async toggleDisabled(user: User): Promise<void> {
    try {
      await api.updateUser(user.id, { disabled: !user.disabled });
      await this.load();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : "Не удалось изменить пользователя");
    }
  }

  async remove(user: User): Promise<void> {
    if (user.id === this.selfId) {
      toasts.error("Нельзя удалить собственную учётную запись");
      return;
    }
    if (!window.confirm(`Удалить пользователя ${user.login}?`)) return;
    try {
      await api.deleteUser(user.id);
      toasts.success("Пользователь удалён");
      await this.load();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : "Не удалось удалить пользователя");
    }
  }
}
