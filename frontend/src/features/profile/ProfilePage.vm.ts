import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaService, QuotaSnapshot } from "@/application/quota/service";
import type { AuthService } from "@/application/auth/service";
import type { AuthSessionInfo, TotpSetup } from "@/domain/auth/types";
import { copyText } from "@/domain/clipboard";
import { ApiError } from "@/domain/errors";
import { initials, userAgentLabel } from "@/domain/format";
import { passwordPolicyIssue } from "@/domain/validation";
import {
  languageOptions,
  isLocale,
  locale,
  setLocale,
  t,
  type LanguageOption,
  type Locale,
  type TranslationKey,
} from "@/i18n";
import { formatBytesI18n, formatDateI18n, formatDateTimeI18n } from "@/i18n/format";

import { FullNameForm } from "./full-name.form";
import { PasswordForm } from "./password.form";
import { TOTP_CODE_PATTERN, TotpDisableForm, TotpEnableForm, TotpSetupForm } from "./totp.form";

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

export interface SessionRow {
  jti: string;
  device: string;
  deviceTitle: string;
  ip: string;
  createdLabel: string;
  expiresLabel: string;
  statusLabel: string;
  statusClass: string;
  active: boolean;
  revocable: boolean;
  busy: boolean;
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

export class ProfilePageVM extends ViewModel {
  readonly passwordForm: PasswordForm;
  readonly fullNameForm: FullNameForm;
  readonly totpSetupForm: TotpSetupForm;
  readonly totpEnableForm: TotpEnableForm;
  readonly totpDisableForm: TotpDisableForm;

  constructor(
    private readonly session: Session,
    private readonly auth: AuthService,
    private readonly quotaService: QuotaService,
    private readonly router: Router,
    private readonly theme: ThemeStore,
    private readonly toasts: ToastStore,
  ) {
    super();
    this.passwordForm = new PasswordForm(this.session.user?.email ?? "");
    this.fullNameForm = new FullNameForm(this.session.user?.full_name ?? "");
    this.totpSetupForm = new TotpSetupForm();
    this.totpEnableForm = new TotpEnableForm();
    this.totpDisableForm = new TotpDisableForm();
  }

  override unmounted(): void {
    this.passwordForm.dispose();
    this.fullNameForm.dispose();
    this.totpSetupForm.dispose();
    this.totpEnableForm.dispose();
    this.totpDisableForm.dispose();
  }

  @reactive accessor saving = false;
  @reactive accessor editingFullName = false;
  @reactive accessor savingFullName = false;
  @reactive accessor quota: QuotaSnapshot | null = null;
  @reactive accessor quotaError: string | null = null;
  @reactive accessor quotaLoading = false;

  @reactive accessor totpOpen = false;
  @reactive accessor totpSetup: TotpSetup | null = null;
  @reactive accessor totpSetupLoading = false;
  @reactive accessor totpSetupError: string | null = null;
  @reactive accessor totpSaving = false;
  @reactive accessor totpDisableOpen = false;
  @reactive accessor totpDisableSaving = false;

  /** Invalidates an in-flight setup request when the modal is closed. */
  private totpSetupRequest = 0;

  @reactive accessor sessions: AuthSessionInfo[] = [];
  @reactive accessor sessionsLoading = false;
  @reactive accessor sessionsError: string | null = null;
  @reactive accessor sessionsBusy = false;
  @reactive accessor sessionsBusyJti: string | null = null;
  @reactive accessor sessionsSearch = "";
  @reactive accessor sessionsOnlyActive = false;

  override created(): void {
    void this.loadQuota();
    void this.loadSessions();
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

  async loadSessions(): Promise<void> {
    this.sessionsLoading = true;
    this.sessionsError = null;
    try {
      this.sessions = await this.auth.sessions();
    } catch (error) {
      this.sessions = [];
      this.sessionsError = userMessage(error, t("profile.sessions.error.load"));
    } finally {
      this.sessionsLoading = false;
    }
  }

  @computed
  get sessionsEmpty(): boolean {
    return this.sessions.length === 0;
  }

  @computed
  get canRevokeAll(): boolean {
    return !this.sessionsBusy && this.sessions.length > 0;
  }

  @computed
  get sessionRows(): SessionRow[] {
    const now = Date.now();
    return this.sessions
      .map((session) => {
        const expired = Date.parse(session.expires_at) <= now;
        const state: "active" | "revoked" | "expired" = session.revoked
          ? "revoked"
          : expired
            ? "expired"
            : "active";
        return {
          session,
          state,
          row: {
            jti: session.jti,
            device: this.sessionDeviceLabel(session),
            deviceTitle: session.user_agent?.trim() || t("profile.sessions.unknownDevice"),
            ip: session.ip?.trim() || "—",
            createdLabel: formatDateTimeI18n(session.created_at),
            expiresLabel: formatDateTimeI18n(session.expires_at),
            statusLabel: t(`profile.sessions.status.${state}`),
            statusClass:
              state === "active" ? "badge--green" : state === "revoked" ? "badge--red" : "badge--gray",
            active: state === "active",
            revocable: state === "active",
            busy: this.sessionsBusyJti === session.jti,
          } satisfies SessionRow,
        };
      })
      .sort((left, right) => {
        const leftActive = left.state === "active" ? 0 : 1;
        const rightActive = right.state === "active" ? 0 : 1;
        if (leftActive !== rightActive) return leftActive - rightActive;
        return Date.parse(right.session.created_at) - Date.parse(left.session.created_at);
      })
      .map(({ row }) => row);
  }

  @computed
  get sessionsFilterActive(): boolean {
    return this.sessionsSearch.trim().length > 0 || this.sessionsOnlyActive;
  }

  @computed
  get filteredSessionRows(): SessionRow[] {
    const query = this.sessionsSearch.trim().toLowerCase();
    return this.sessionRows.filter((row) => {
      if (this.sessionsOnlyActive && !row.active) return false;
      if (query.length === 0) return true;
      return (
        row.device.toLowerCase().includes(query) ||
        row.deviceTitle.toLowerCase().includes(query) ||
        row.ip.toLowerCase().includes(query)
      );
    });
  }

  @computed
  get filteredSessionsEmpty(): boolean {
    return !this.sessionsEmpty && this.filteredSessionRows.length === 0;
  }

  setSessionsSearch(event: Event): void {
    this.sessionsSearch = (event.target as HTMLInputElement).value;
  }

  setSessionsOnlyActive(event: Event): void {
    this.sessionsOnlyActive = (event.target as HTMLInputElement).checked;
  }

  resetSessionFilters(): void {
    this.sessionsSearch = "";
    this.sessionsOnlyActive = false;
  }

  async revokeSession(jti: string): Promise<void> {
    if (this.sessionsBusy) return;
    const confirmed = await askConfirm({
      title: t("profile.sessions.confirm.revoke.title"),
      message: t("profile.sessions.confirm.revoke"),
      confirmLabel: t("profile.sessions.revoke"),
    });
    if (!confirmed) return;
    this.sessionsBusy = true;
    this.sessionsBusyJti = jti;
    try {
      await this.auth.revokeSession(jti);
      this.toasts.success(t("profile.sessions.success.revoked"));
      await this.loadSessions();
    } catch (error) {
      this.toasts.error(userMessage(error, t("profile.sessions.error.revoke")));
    } finally {
      this.sessionsBusy = false;
      this.sessionsBusyJti = null;
    }
  }

  async revokeAll(): Promise<void> {
    if (this.sessionsBusy) return;
    const confirmed = await askConfirm({
      title: t("profile.sessions.confirm.revokeAll.title"),
      message: t("profile.sessions.confirm.revokeAll"),
      confirmLabel: t("profile.sessions.revokeAll"),
    });
    if (!confirmed) return;
    this.sessionsBusy = true;
    try {
      const result = await this.auth.logoutAll();
      this.toasts.success(
        t("profile.sessions.success.revokedAll", { count: result.revoked }),
      );
      await this.logout();
    } catch (error) {
      this.toasts.error(userMessage(error, t("profile.sessions.error.revokeAll")));
    } finally {
      this.sessionsBusy = false;
    }
  }

  private sessionDeviceLabel(session: AuthSessionInfo): string {
    const agent = session.user_agent?.trim() ?? "";
    const label = userAgentLabel(agent);
    if (label !== null) return label;
    if (agent.length > 48) return `${agent.slice(0, 47)}…`;
    return agent || t("profile.sessions.unknownDevice");
  }

  @computed
  get email(): string {
    return this.session.user?.email ?? t("common.guest");
  }

  @computed
  get fullName(): string {
    return this.session.user?.full_name?.trim() || t("profile.fullName.empty");
  }

  @computed
  get hasFullName(): boolean {
    return (this.session.user?.full_name?.trim() ?? "").length > 0;
  }

  @computed
  get userInitial(): string {
    const name = this.session.user?.full_name?.trim();
    return initials(name && name.length > 0 ? name : this.email);
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
  get loggingOut(): boolean {
    return this.session.loggingOut;
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
    return languageOptions();
  }

  @computed
  get canSave(): boolean {
    const form = this.passwordForm;
    const email = this.session.user?.email ?? form.email;
    return (
      !this.saving &&
      form.currentPassword.length > 0 &&
      form.nextPassword.length > 0 &&
      form.repeatPassword.length > 0 &&
      passwordPolicyIssue(form.nextPassword, email) === null &&
      form.nextPassword === form.repeatPassword
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

  startFullNameEdit(): void {
    this.fullNameForm.fullName = this.session.user?.full_name ?? "";
    this.fullNameForm.clearFieldErrors("fullName");
    this.editingFullName = true;
  }

  cancelFullNameEdit(): void {
    if (this.savingFullName) return;
    this.editingFullName = false;
    this.fullNameForm.fullName = this.session.user?.full_name ?? "";
    this.fullNameForm.clearFieldErrors("fullName");
  }

  async saveFullName(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.savingFullName) return;
    const field = this.fullNameForm.getFieldProps("fullName");
    const trimmed = field.value.trim();
    // Пустое значение по-прежнему очищает ФИО через null в API.
    if (trimmed.length === 0) {
      await this.persistFullName(null, event);
      return;
    }
    await this.fullNameForm.onSubmit(async (form) => {
      await this.persistFullName(form.fullName.trim(), event);
    })(event);
  }

  private async persistFullName(value: string | null, event?: Event): Promise<void> {
    event?.preventDefault();
    this.savingFullName = true;
    this.fullNameForm.clearFieldErrors("fullName");
    try {
      const updated = await this.auth.updateProfile({ full_name: value });
      this.session.user = updated;
      this.fullNameForm.fullName = updated.full_name ?? "";
      this.editingFullName = false;
      this.toasts.success(t("profile.fullName.success"));
    } catch (error) {
      this.fullNameForm.setFieldErrors(
        "fullName",
        userMessage(error, t("profile.fullName.error.save")),
      );
    } finally {
      this.savingFullName = false;
    }
  }

  async savePassword(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving) return;
    const form = this.passwordForm;
    form.email = this.session.user?.email ?? form.email;
    this.saving = true;
    try {
      const valid = await form.validate();
      if (!valid) {
        const message = formError(form.errors, [
          "currentPassword",
          "nextPassword",
          "repeatPassword",
        ]);
        if (message !== undefined) this.toasts.error(message);
        return;
      }
      await this.auth.changePassword(form.currentPassword, form.nextPassword);
      form.reset();
      this.toasts.success(t("profile.password.success"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("profile.password.error.failed");
      form.setFieldErrors("currentPassword", message);
      this.toasts.error(message);
    } finally {
      this.saving = false;
    }
  }

  @computed
  get totpEnabled(): boolean {
    return this.session.user?.totp_enabled ?? false;
  }

  @computed
  get totpStatusLabel(): string {
    return this.totpEnabled ? t("profile.totp.status.enabled") : t("profile.totp.status.disabled");
  }

  @computed
  get totpStatusBadge(): string {
    return this.totpEnabled ? "badge badge--green" : "badge badge--blue";
  }

  @computed
  get canSubmitTotpSetup(): boolean {
    return !this.totpSetupLoading && this.totpSetupForm.password.length > 0;
  }

  @computed
  get canEnableTotp(): boolean {
    return (
      !this.totpSaving &&
      this.totpEnableForm.password.length > 0 &&
      TOTP_CODE_PATTERN.test(this.totpEnableForm.code.trim())
    );
  }

  @computed
  get canDisableTotp(): boolean {
    return (
      !this.totpDisableSaving &&
      this.totpDisableForm.password.length > 0 &&
      TOTP_CODE_PATTERN.test(this.totpDisableForm.code.trim())
    );
  }

  async toggleTotp(): Promise<void> {
    if (this.totpEnabled) {
      this.openTotpDisable();
      return;
    }
    this.openTotpSetup();
  }

  openTotpSetup(): void {
    this.totpSetupRequest += 1;
    this.totpOpen = true;
    this.totpSetup = null;
    this.totpSetupForm.reset();
    this.totpEnableForm.reset();
    this.totpSetupLoading = false;
    this.totpSetupError = null;
  }

  async submitTotpSetup(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.totpSetupLoading) return;
    if (!(await this.totpSetupForm.validate())) {
      this.totpSetupError = formError(this.totpSetupForm.errors, ["password"]) ??
        t("profile.totp.error.passwordRequired");
      return;
    }
    const password = this.totpSetupForm.password;
    const request = ++this.totpSetupRequest;
    this.totpSetupLoading = true;
    this.totpSetupError = null;
    try {
      const setup = await this.auth.totpSetup(password);
      if (request !== this.totpSetupRequest) return;
      this.totpSetup = setup;
      this.totpEnableForm.password = password;
      this.totpEnableForm.code = "";
      this.totpEnableForm.clearFieldErrors();
    } catch (error) {
      if (request !== this.totpSetupRequest) return;
      this.totpSetup = null;
      const message = this.totpErrorMessage(error, t("profile.totp.error.setup"));
      this.totpSetupForm.setFieldErrors("password", message);
      this.totpSetupError = message;
    } finally {
      if (request === this.totpSetupRequest) this.totpSetupLoading = false;
    }
  }

  closeTotpSetup(): void {
    if (this.totpSaving) return;
    this.totpSetupRequest += 1;
    this.totpOpen = false;
    this.totpSetup = null;
    this.totpSetupForm.reset();
    this.totpEnableForm.reset();
    this.totpSetupError = null;
    this.totpSetupLoading = false;
  }

  async submitTotpEnable(): Promise<void> {
    if (this.totpSaving) return;
    this.totpEnableForm.password = this.totpSetupForm.password;
    if (!(await this.totpEnableForm.validate())) {
      const message = formError(this.totpEnableForm.errors, ["password", "code"]) ??
        t("profile.totp.error.invalidCode");
      this.toasts.error(message);
      return;
    }
    this.totpSaving = true;
    try {
      await this.auth.totpEnable(
        this.totpEnableForm.password,
        this.totpEnableForm.code.trim(),
      );
      this.totpSetupRequest += 1;
      this.totpOpen = false;
      this.totpSetup = null;
      this.totpSetupForm.reset();
      this.totpEnableForm.reset();
      this.totpSetupError = null;
      this.toasts.success(t("profile.totp.success.enabled"));
      await this.session.reload();
    } catch (error) {
      this.toasts.error(this.totpErrorMessage(error, t("profile.totp.error.enable")));
    } finally {
      this.totpSaving = false;
    }
  }

  openTotpDisable(): void {
    this.totpDisableOpen = true;
    this.totpDisableForm.reset();
  }

  closeTotpDisable(): void {
    if (this.totpDisableSaving) return;
    this.totpDisableOpen = false;
    this.totpDisableForm.reset();
  }

  async submitTotpDisable(): Promise<void> {
    if (!(await this.totpDisableForm.validate())) {
      const message = formError(this.totpDisableForm.errors, ["password", "code"]) ??
        t("profile.totp.error.invalidCode");
      this.toasts.error(message);
      return;
    }
    this.totpDisableSaving = true;
    try {
      await this.auth.totpDisable(
        this.totpDisableForm.password,
        this.totpDisableForm.code.trim(),
      );
      this.totpDisableOpen = false;
      this.totpDisableForm.reset();
      this.toasts.success(t("profile.totp.success.disabled"));
      await this.session.reload();
    } catch (error) {
      this.toasts.error(userMessage(error, t("profile.totp.error.disable")));
    } finally {
      this.totpDisableSaving = false;
    }
  }

  async copyRecoveryCodes(): Promise<void> {
    const codes = this.totpSetup?.recovery_codes ?? [];
    if (codes.length === 0) return;
    try {
      await copyText(codes.join("\n"));
      this.toasts.success(t("profile.totp.modal.copied"));
    } catch {
      this.toasts.error(t("profile.totp.error.copy"));
    }
  }

  async copyTotpSecret(): Promise<void> {
    const secret = this.totpSetup?.secret ?? "";
    if (secret.length === 0) return;
    try {
      await copyText(secret);
      this.toasts.success(t("profile.totp.modal.secretCopied"));
    } catch {
      this.toasts.error(t("profile.totp.error.copy"));
    }
  }

  private totpErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError && (error.status === 403 || error.status === 422)) {
      const message = error.message.trim();
      if (message.length > 0 && message !== `HTTP ${error.status}`) return message;
    }
    return userMessage(error, fallback);
  }

  async logout(): Promise<void> {
    if (this.session.loggingOut) return;
    await this.session.logout();
    this.router.replace("/login");
  }
}

function formError(
  errors: Readonly<Record<string, readonly string[]>>,
  paths: readonly string[],
): string | undefined {
  for (const path of paths) {
    const message = errors[path]?.[0];
    if (message !== undefined) return message;
  }
  return undefined;
}
