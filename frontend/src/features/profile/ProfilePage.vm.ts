import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaSnapshot } from "../../application/quota/service";
import type { AuthService } from "../../application/auth/service";
import { formatDate, formatDateRu, initials } from "@/domain/format";

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
  constructor(
    private readonly session: Session,
    private readonly auth: AuthService,
    private readonly quotaService: QuotaService,
    private readonly router: Router,
    private readonly theme: ThemeStore,
    private readonly toasts: ToastStore,
  ) {}

  @reactive accessor currentPassword = "";
  @reactive accessor nextPassword = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor saving = false;
  @reactive accessor quota: QuotaSnapshot | null = null;
  @reactive accessor quotaError: string | null = null;
  @reactive accessor quotaLoading = false;

  created(): void {
    void this.loadQuota();
  }

  async loadQuota(): Promise<void> {
    this.quotaLoading = true;
    this.quotaError = null;
    try {
      this.quota = await this.quotaService.me();
    } catch (error) {
      this.quota = null;
      this.quotaError = userMessage(error, "Не удалось загрузить квоту трафика");
    } finally {
      this.quotaLoading = false;
    }
  }

  @computed
  get login(): string {
    return this.session.user?.login ?? "Гость";
  }

  @computed
  get userInitial(): string {
    return initials(this.login);
  }

  @computed
  get userId(): string {
    return this.session.user?.id ?? "—";
  }

  @computed
  get createdAtLabel(): string {
    return formatDate(this.session.user?.created_at);
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
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
  get quotaView(): QuotaDisplay {
    return quotaDisplay(this.quota);
  }

  @computed
  get quotaResetLabel(): string {
    return formatDateRu(this.quota?.resetAt);
  }

  @computed
  get quotaPeriodLabel(): string {
    if (!this.quota) return "—";
    return `${formatDateRu(this.quota.periodStart)} — ${formatDateRu(this.quota.periodEnd)}`;
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
    return this.theme.effective;
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
    return this.theme.mode === mode;
  }

  setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
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
      this.toasts.error("Введите текущий пароль");
      return;
    }
    if (this.nextPassword.length < 8) {
      this.toasts.error("Новый пароль должен содержать минимум 8 символов");
      return;
    }
    if (this.nextPassword !== this.repeatPassword) {
      this.toasts.error("Пароли не совпадают");
      return;
    }

    this.saving = true;
    try {
      await this.auth.changePassword(this.currentPassword, this.nextPassword);
      this.currentPassword = "";
      this.nextPassword = "";
      this.repeatPassword = "";
      this.toasts.success("Пароль обновлён");
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : "Не удалось изменить пароль");
    } finally {
      this.saving = false;
    }
  }

  async logout(): Promise<void> {
    await this.session.logout();
    this.router.replace("/login");
  }
}
