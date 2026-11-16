import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, router, session, theme, toasts } from "@/app/container";
import type { ThemeMode } from "@/app/theme";
import { formatDate, initials } from "@/domain/format";

export interface PermissionItem {
  key: string;
  label: string;
  description: string;
  granted: boolean;
}

export interface ThemeOption {
  value: ThemeMode;
  label: string;
  description: string;
}

interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

const PERMISSION_DEFS: PermissionDef[] = [
  {
    key: "read",
    label: "Просмотр",
    description: "Ноды, интерфейсы, устройства и статистика.",
  },
  {
    key: "write",
    label: "Изменения",
    description: "Создание и редактирование клиентов.",
  },
  {
    key: "manage_users",
    label: "Управление пользователями",
    description: "Роли, учётные записи и сброс паролей.",
  },
  {
    key: "export_config",
    label: "Экспорт конфигов",
    description: "Выгрузка серверных и клиентских конфигураций.",
  },
  {
    key: "share_config",
    label: "Общий доступ",
    description: "Создание и отзыв ссылок на конфиги устройств.",
  },
  {
    key: "profile",
    label: "Профиль",
    description: "Смена собственного пароля и оформления.",
  },
];

const USER_PERMISSIONS = new Set<string>(["read", "write", "share_config", "profile"]);

const THEME_OPTIONS: ThemeOption[] = [
  { value: "system", label: "Системная", description: "Как в операционной системе" },
  { value: "light", label: "Светлая", description: "Всегда светлое оформление" },
  { value: "dark", label: "Тёмная", description: "Всегда тёмное оформление" },
];

export class ProfilePageVM {
  @reactive accessor currentPassword = "";
  @reactive accessor nextPassword = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor saving = false;

  @computed
  get login(): string {
    return session.user?.login ?? "Гость";
  }

  @computed
  get userInitial(): string {
    return initials(this.login);
  }

  @computed
  get userId(): string {
    return session.user?.id ?? "—";
  }

  @computed
  get createdAtLabel(): string {
    return formatDate(session.user?.created_at);
  }

  @computed
  get isAdmin(): boolean {
    return session.isAdmin;
  }

  @computed
  get roleLabel(): string {
    return this.isAdmin ? "Администратор" : "Пользователь";
  }

  @computed
  get roleBadgeClass(): string {
    return this.isAdmin ? "badge badge--violet" : "badge badge--blue";
  }

  @computed
  get permissions(): PermissionItem[] {
    return PERMISSION_DEFS.map((permission) => ({
      ...permission,
      granted: this.isAdmin || USER_PERMISSIONS.has(permission.key),
    }));
  }

  @computed
  get themeOptions(): ThemeOption[] {
    return THEME_OPTIONS;
  }

  @computed
  get effectiveTheme(): "light" | "dark" {
    return theme.effective;
  }

  @computed
  get effectiveThemeLabel(): string {
    return this.effectiveTheme === "dark" ? "Тёмная" : "Светлая";
  }

  @computed
  get nextTooShort(): boolean {
    return this.nextPassword.length > 0 && this.nextPassword.length < 8;
  }

  @computed
  get repeatMismatch(): boolean {
    return this.repeatPassword.length > 0 && this.nextPassword !== this.repeatPassword;
  }

  @computed
  get canSave(): boolean {
    return (
      !this.saving &&
      this.currentPassword.length > 0 &&
      this.nextPassword.length >= 8 &&
      this.nextPassword === this.repeatPassword
    );
  }

  isTheme(mode: ThemeMode): boolean {
    return theme.mode === mode;
  }

  setTheme(mode: ThemeMode): void {
    theme.set(mode);
  }

  setCurrentPassword(event: Event): void {
    this.currentPassword = (event.target as HTMLInputElement).value;
  }

  setNextPassword(event: Event): void {
    this.nextPassword = (event.target as HTMLInputElement).value;
  }

  setRepeatPassword(event: Event): void {
    this.repeatPassword = (event.target as HTMLInputElement).value;
  }

  async savePassword(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving) return;
    if (this.currentPassword.length === 0) {
      toasts.error("Введите текущий пароль");
      return;
    }
    if (this.nextPassword.length < 8) {
      toasts.error("Новый пароль должен содержать минимум 8 символов");
      return;
    }
    if (this.nextPassword !== this.repeatPassword) {
      toasts.error("Пароли не совпадают");
      return;
    }

    this.saving = true;
    try {
      await api.changePassword(this.currentPassword, this.nextPassword);
      this.currentPassword = "";
      this.nextPassword = "";
      this.repeatPassword = "";
      toasts.success("Пароль обновлён");
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : "Не удалось изменить пароль");
    } finally {
      this.saving = false;
    }
  }

  async logout(): Promise<void> {
    await session.logout();
    router.replace("/login");
  }
}
