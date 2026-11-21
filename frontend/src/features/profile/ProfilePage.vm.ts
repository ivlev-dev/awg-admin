import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore, type ThemeMode } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import { FULL_NAME_MAX } from "@/application/guards";
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
  constructor(
    private readonly session: Session,
    private readonly auth: AuthService,
    private readonly quotaService: QuotaService,
    private readonly router: Router,
    private readonly theme: ThemeStore,
    private readonly toasts: ToastStore,
  ) {
    super();
  }

  @reactive accessor currentPassword = "";
  @reactive accessor nextPassword = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor saving = false;
  @reactive accessor editingFullName = false;
  @reactive accessor fullNameDraft = "";
  @reactive accessor savingFullName = false;
  @reactive accessor fullNameError: string | null = null;
  @reactive accessor quota: QuotaSnapshot | null = null;
  @reactive accessor quotaError: string | null = null;
  @reactive accessor quotaLoading = false;

  @reactive accessor totpOpen = false;
  @reactive accessor totpSetup: TotpSetup | null = null;
  @reactive accessor totpSetupPassword = "";
  @reactive accessor totpSetupLoading = false;
  @reactive accessor totpSetupError: string | null = null;
  @reactive accessor totpCode = "";
  @reactive accessor totpSaving = false;
  @reactive accessor totpDisableOpen = false;
  @reactive accessor totpDisablePassword = "";
  @reactive accessor totpDisableCode = "";
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
  get nextPasswordIssue(): string | null {
    return passwordPolicyIssue(this.nextPassword, this.session.user?.email ?? "");
  }

  @computed
  get nextTooShort(): boolean {
    return this.nextPassword.length > 0 && this.nextPasswordIssue === "short";
  }

  @computed
  get nextPasswordError(): string | null {
    switch (this.nextPasswordIssue) {
      case "short":
        return t("profile.password.error.tooShort");
      case "long":
        return t("profile.password.error.tooLong");
      case "common":
        return t("profile.password.error.weak");
      case "email":
        return t("profile.password.error.email");
      default:
        return null;
    }
  }

  @computed
  get nextPasswordInvalid(): boolean {
    return this.nextPassword.length > 0 && this.nextPasswordError !== null;
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
      this.nextPassword.length > 0 &&
      this.nextPasswordIssue === null &&
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

  startFullNameEdit(): void {
    this.fullNameDraft = this.session.user?.full_name ?? "";
    this.fullNameError = null;
    this.editingFullName = true;
  }

  cancelFullNameEdit(): void {
    if (this.savingFullName) return;
    this.editingFullName = false;
    this.fullNameDraft = "";
    this.fullNameError = null;
  }

  setFullNameDraft(event: Event): void {
    this.fullNameDraft = (event.target as HTMLInputElement).value;
    this.fullNameError = null;
  }

  async saveFullName(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.savingFullName) return;
    const trimmed = this.fullNameDraft.trim();
    if ([...trimmed].length > FULL_NAME_MAX) {
      this.fullNameError = t("profile.fullName.error.tooLong", { max: FULL_NAME_MAX });
      return;
    }
    this.savingFullName = true;
    this.fullNameError = null;
    try {
      const updated = await this.auth.updateProfile({
        full_name: trimmed.length === 0 ? null : trimmed,
      });
      this.session.user = updated;
      this.editingFullName = false;
      this.fullNameDraft = "";
      this.toasts.success(t("profile.fullName.success"));
    } catch (error) {
      this.fullNameError = userMessage(error, t("profile.fullName.error.save"));
    } finally {
      this.savingFullName = false;
    }
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
    const passwordError = this.nextPasswordError;
    if (passwordError !== null) {
      this.toasts.error(passwordError);
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
    return !this.totpSetupLoading && this.totpSetupPassword.length > 0;
  }

  @computed
  get canEnableTotp(): boolean {
    return (
      !this.totpSaving &&
      this.totpSetupPassword.length > 0 &&
      /^\d{6}$/.test(this.totpCode.trim())
    );
  }

  @computed
  get canDisableTotp(): boolean {
    return (
      !this.totpDisableSaving &&
      this.totpDisablePassword.length > 0 &&
      /^\d{6}$/.test(this.totpDisableCode.trim())
    );
  }

  setTotpCode(event: Event): void {
    this.totpCode = (event.target as HTMLInputElement).value;
  }

  setTotpSetupPassword(event: Event): void {
    this.totpSetupPassword = (event.target as HTMLInputElement).value;
    this.totpSetupError = null;
  }

  setTotpDisablePassword(event: Event): void {
    this.totpDisablePassword = (event.target as HTMLInputElement).value;
  }

  setTotpDisableCode(event: Event): void {
    this.totpDisableCode = (event.target as HTMLInputElement).value;
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
    this.totpSetupPassword = "";
    this.totpSetupLoading = false;
    this.totpSetupError = null;
    this.totpCode = "";
  }

  async submitTotpSetup(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.totpSetupLoading) return;
    if (this.totpSetupPassword.length === 0) {
      this.totpSetupError = t("profile.totp.error.passwordRequired");
      return;
    }
    const password = this.totpSetupPassword;
    const request = ++this.totpSetupRequest;
    this.totpSetupLoading = true;
    this.totpSetupError = null;
    try {
      const setup = await this.auth.totpSetup(password);
      if (request !== this.totpSetupRequest) return;
      this.totpSetup = setup;
      this.totpCode = "";
    } catch (error) {
      if (request !== this.totpSetupRequest) return;
      this.totpSetup = null;
      this.totpSetupError = this.totpErrorMessage(error, t("profile.totp.error.setup"));
    } finally {
      if (request === this.totpSetupRequest) this.totpSetupLoading = false;
    }
  }

  closeTotpSetup(): void {
    if (this.totpSaving) return;
    this.totpSetupRequest += 1;
    this.totpOpen = false;
    this.totpSetup = null;
    this.totpSetupPassword = "";
    this.totpSetupError = null;
    this.totpSetupLoading = false;
    this.totpCode = "";
  }

  async submitTotpEnable(): Promise<void> {
    if (this.totpSaving) return;
    if (this.totpSetupPassword.length === 0) {
      this.toasts.error(t("profile.totp.error.passwordRequired"));
      return;
    }
    if (!/^\d{6}$/.test(this.totpCode.trim())) {
      this.toasts.error(t("profile.totp.error.invalidCode"));
      return;
    }
    this.totpSaving = true;
    try {
      await this.auth.totpEnable(this.totpSetupPassword, this.totpCode.trim());
      this.totpSetupRequest += 1;
      this.totpOpen = false;
      this.totpSetup = null;
      this.totpSetupPassword = "";
      this.totpSetupError = null;
      this.totpCode = "";
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
    this.totpDisablePassword = "";
    this.totpDisableCode = "";
  }

  closeTotpDisable(): void {
    if (this.totpDisableSaving) return;
    this.totpDisableOpen = false;
    this.totpDisablePassword = "";
    this.totpDisableCode = "";
  }

  async submitTotpDisable(): Promise<void> {
    if (!this.canDisableTotp) {
      this.toasts.error(t("profile.totp.error.invalidCode"));
      return;
    }
    this.totpDisableSaving = true;
    try {
      await this.auth.totpDisable(this.totpDisablePassword, this.totpDisableCode.trim());
      this.totpDisableOpen = false;
      this.totpDisablePassword = "";
      this.totpDisableCode = "";
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
