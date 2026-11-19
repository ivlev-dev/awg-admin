import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

export type LoginStep = "credentials" | "totp";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

function validEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function validTotpCode(value: string): boolean {
  const code = value.trim();
  return /^\d{6}$/.test(code) || /^[A-Za-z0-9-]{6,}$/.test(code);
}

export class LoginVM extends ViewModel {
  constructor(
    private readonly session: Session,
    private readonly router: Router,
    private readonly auth: AuthService,
  ) {
    super();
  }

  @reactive accessor email = "";
  @reactive accessor password = "";
  @reactive accessor totpCode = "";
  @reactive accessor step: LoginStep = "credentials";
  @reactive accessor showPassword = false;
  @reactive accessor resending = false;
  @reactive accessor resendNotice: string | null = null;
  @reactive accessor resendError: string | null = null;

  override created(): void {
    if (this.session.authenticated) {
      this.router.replace("/");
    }
  }

  @computed
  get busy(): boolean {
    return this.session.busy;
  }

  @computed
  get error(): string | null {
    switch (this.session.errorCode) {
      case "email_not_verified":
        return t("auth.login.error.emailNotVerified");
      case "pending_approval":
        return t("auth.login.error.pendingApproval");
      case "rejected":
        return t("auth.login.error.rejected");
      case "totp_invalid":
        return t("auth.login.error.totpInvalid");
      default:
        return this.session.error;
    }
  }

  @computed
  get emailValid(): boolean {
    return validEmail(this.email);
  }

  @computed
  get emailInvalid(): boolean {
    return this.email.trim().length > 0 && !this.emailValid;
  }

  @computed
  get canSubmit(): boolean {
    if (this.busy) return false;
    if (this.step === "totp") return validTotpCode(this.totpCode);
    return this.emailValid && this.password.length > 0;
  }

  @computed
  get canResend(): boolean {
    return this.session.errorCode === "email_not_verified" && !this.resending;
  }

  @computed
  get showResend(): boolean {
    return this.session.errorCode === "email_not_verified";
  }

  setEmail(event: Event): void {
    this.email = (event.target as HTMLInputElement).value;
    this.resendNotice = null;
    this.resendError = null;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  setTotpCode(event: Event): void {
    this.totpCode = (event.target as HTMLInputElement).value;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit) return;
    const code = this.step === "totp" ? this.totpCode.trim() : undefined;
    const success = await this.session.login(this.email.trim(), this.password, code);
    if (success) {
      this.router.replace("/");
      return;
    }
    if (this.session.totpRequired) {
      this.step = "totp";
      this.session.clearError();
    }
  }

  backToCredentials(): void {
    this.step = "credentials";
    this.totpCode = "";
    this.session.clearError();
    this.resendNotice = null;
    this.resendError = null;
  }

  async resend(): Promise<void> {
    if (!this.canResend) return;
    this.resending = true;
    this.resendNotice = null;
    this.resendError = null;
    try {
      await this.auth.resendVerification(this.email.trim());
      this.resendNotice = t("auth.login.resend.sent");
    } catch (error) {
      this.resendError = userMessage(error, t("auth.login.resend.failed"));
    } finally {
      this.resending = false;
    }
  }

  goRegister(): void {
    this.router.navigate("/register");
  }

  goForgotPassword(): void {
    this.router.navigate("/forgot-password");
  }
}
