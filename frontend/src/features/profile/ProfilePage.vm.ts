import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaSnapshot } from "../../application/quota/service";
import type { AuthService } from "../../application/auth/service";
import { initials } from "@/domain/format";
import {
  LANGUAGE_OPTIONS,
  isLocale,
  locale,
  setLocale,
  t,
  type LanguageOption,
  type Locale,
  type TranslationKey,
} from "@/i18n";
import { formatBytesI18n, formatDateI18n, formatDateTimeI18n } from "@/i18n/format";

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
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

interface ThemeDefinition {
  value: ThemeMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

const PERMISSION_DEFS: PermissionDef[] = [
  {
    key: "read",
    labelKey: "permission.read.label",
    descriptionKey: "permission.read.description",
  },
  {
    key: "write",
    labelKey: "permission.write.label",
    descriptionKey: "permission.write.description",
  },
  {
    key: "manage_users",
    labelKey: "permission.manage_users.label",
    descriptionKey: "permission.manage_users.description",
  },
  {
    key: "export_config",
    labelKey: "permission.export_config.label",
    descriptionKey: "permission.export_config.description",
  },
  {
    key: "share_config",
    labelKey: "permission.share_config.label",
    descriptionKey: "permission.share_config.description",
  },
  {
    key: "profile",
    labelKey: "permission.profile.label",
    descriptionKey: "permission.profile.description",
  },
];

const USER_PERMISSIONS = new Set<string>(["read", "write", "share_config", "profile"]);

const THEME_DEFINITIONS: ThemeDefinition[] = [
  { value: "system", labelKey: "profile.theme.system", descriptionKey: "profile.theme.system.description" },
  { value: "light", labelKey: "profile.theme.light", descriptionKey: "profile.theme.light.description" },
  { value: "dark", labelKey: "profile.theme.dark", descriptionKey: "profile.theme.dark.description" },
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
      this.quotaError = userMessage(error, t("quota.error.load"));
    } finally {
      this.quotaLoading = false;
    }
  }

  @computed
  get login(): string {
    return this.session.user?.login ?? t("common.guest");
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
    return formatDateTimeI18n(this.session.user?.created_at);
  }

  @computed
  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get roleLabel(): string {
    return this.isAdmin ? t("role.admin") : t("role.user");
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
  get quotaUsedLabel(): string {
    return formatBytesI18n(this.quota?.usedBytes ?? 0);
  }

  @computed
  get quotaLimitLabel(): string {
    const limit = this.quota?.quotaBytes;
    return limit === null || limit === undefined ? t("common.unlimited") : formatBytesI18n(limit);
  }

  @computed
  get quotaRemainingLabel(): string {
    const remaining = this.quota?.remainingBytes;
    return remaining === null || remaining === undefined
      ? t("common.unlimited")
      : formatBytesI18n(remaining);
  }

  @computed
  get quotaStatusLabel(): string {
    if (this.quotaView.exceeded) return t("quota.status.exceeded");
    return this.quotaView.hasQuota ? t("quota.status.ok") : t("common.unlimited");
  }

  @computed
  get quotaResetLabel(): string {
    return formatDateI18n(this.quota?.resetAt);
  }

  @computed
  get quotaPeriodLabel(): string {
    if (!this.quota) return "—";
    return `${formatDateI18n(this.quota.periodStart)} — ${formatDateI18n(this.quota.periodEnd)}`;
  }

  @computed
  get permissions(): PermissionItem[] {
    return PERMISSION_DEFS.map((permission) => ({
      key: permission.key,
      label: t(permission.labelKey),
      description: t(permission.descriptionKey),
      granted: this.isAdmin || USER_PERMISSIONS.has(permission.key),
    }));
  }

  @computed
  get themeOptions(): ThemeOption[] {
    return THEME_DEFINITIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: t(option.descriptionKey),
    }));
  }

  @computed
  get effectiveTheme(): "light" | "dark" {
    return this.theme.effective;
  }

  @computed
  get effectiveThemeLabel(): string {
    return this.effectiveTheme === "dark" ? t("profile.theme.dark") : t("profile.theme.light");
  }

  @computed
  get language(): Locale {
    return locale();
  }

  get languageOptions(): readonly LanguageOption[] {
    return LANGUAGE_OPTIONS;
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

  isLanguage(value: Locale): boolean {
    return this.language === value;
  }

  setLanguage(value: string): void {
    if (isLocale(value)) setLocale(value);
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
      this.toasts.error(t("profile.password.error.currentRequired"));
      return;
    }
    if (this.nextPassword.length < 8) {
      this.toasts.error(t("profile.password.error.tooShort"));
      return;
    }
    if (this.nextPassword !== this.repeatPassword) {
      this.toasts.error(t("profile.password.error.mismatch"));
      return;
    }

    this.saving = true;
    try {
      await this.auth.changePassword(this.currentPassword, this.nextPassword);
      this.currentPassword = "";
      this.nextPassword = "";
      this.repeatPassword = "";
      this.toasts.success(t("profile.password.success"));
    } catch (error) {
      this.toasts.error(
        error instanceof Error ? error.message : t("profile.password.error.failed"),
      );
    } finally {
      this.saving = false;
    }
  }

  async logout(): Promise<void> {
    await this.session.logout();
    this.router.replace("/login");
  }
}
