import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

import { EMAIL_PATTERN, LoginForm, TOTP_PATTERN } from "./Login.form";

export type LoginStep = "credentials" | "totp";

export class LoginVM extends ViewModel {
  readonly form = new LoginForm();

  @reactive accessor step: LoginStep = "credentials";
  @reactive accessor showPassword = false;
  @reactive accessor resending = false;
  @reactive accessor resendNotice: string | null = null;
  @reactive accessor resendError: string | null = null;

  constructor(
    private readonly session: Session,
    private readonly router: Router,
    private readonly auth: AuthService,
  ) {
    super();
  }

  override created(): void {
    if (this.session.authenticated) {
      this.router.replace("/");
    }
  }

  override unmounted(): void {
    this.form.dispose();
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
      case "registration_disabled":
        return t("auth.register.error.registrationDisabled");
      default:
        return this.session.error;
    }
  }

  @computed
  get canSubmit(): boolean {
    if (this.busy) return false;
    if (this.step === "totp") {
      return TOTP_PATTERN.test(this.form.totpCode.trim());
    }
    return EMAIL_PATTERN.test(this.form.email.trim()) && this.form.password.length > 0;
  }

  @computed
  get canResend(): boolean {
    return this.session.errorCode === "email_not_verified" && !this.resending;
  }

  @computed
  get showResend(): boolean {
    return this.session.errorCode === "email_not_verified";
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    const emailField = this.form.getFieldProps("email");
    emailField.setValue(emailField.value.trim());
    const totpField = this.form.getFieldProps("totpCode");
    if (this.step === "totp") totpField.setValue(totpField.value.trim());

    await this.form.onSubmit(async () => {
      this.resendNotice = null;
      this.resendError = null;
      const code = this.step === "totp" ? this.form.totpCode : undefined;
      const success = await this.session.login(this.form.email, this.form.password, code);
      if (success) {
        this.router.replace("/");
        return;
      }
      if (this.session.totpRequired) {
        this.form.totpRequired = true;
        this.step = "totp";
        this.session.clearError();
      }
    })(event);
  }

  backToCredentials(): void {
    this.step = "credentials";
    this.form.totpRequired = false;
    this.form.getFieldProps("totpCode").setValue("");
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
      await this.auth.resendVerification(this.form.email.trim());
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
