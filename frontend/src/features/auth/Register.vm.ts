import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Cooldown } from "@/app/cooldown";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { FULL_NAME_MAX } from "@/application/guards";
import { ApiError } from "@/domain/errors";
import { passwordPolicyIssue } from "@/domain/validation";
import { t } from "@/i18n";

import { EMAIL_PATTERN, RegisterForm } from "./Register.form";

const COOLDOWN_SECONDS = 60;

export class RegisterVM extends ViewModel {
  readonly form = new RegisterForm();

  @reactive accessor showPassword = false;
  @reactive accessor submitting = false;
  @reactive accessor error: string | null = null;
  @reactive accessor sent = false;
  @reactive accessor registeredEmail = "";
  @reactive accessor cooldown = 0;
  @reactive accessor resending = false;
  @reactive accessor resendNotice: string | null = null;
  @reactive accessor resendError: string | null = null;

  private readonly clock = new Cooldown(COOLDOWN_SECONDS, (remaining) => {
    this.cooldown = remaining;
  });

  constructor(
    private readonly auth: AuthService,
    private readonly session: Session,
    private readonly router: Router,
  ) {
    super();
  }

  override created(): void {
    if (this.session.authenticated) {
      this.router.replace("/");
    }
  }

  override unmounted(): void {
    this.stopCooldown();
    this.form.dispose();
  }

  @computed
  get canSubmit(): boolean {
    if (this.submitting) return false;
    const email = this.form.email.trim();
    const password = this.form.password;
    return (
      EMAIL_PATTERN.test(email) &&
      [...this.form.fullName.trim()].length <= FULL_NAME_MAX &&
      password.length > 0 &&
      passwordPolicyIssue(password, email) === null &&
      password === this.form.repeatPassword
    );
  }

  @computed
  get canResend(): boolean {
    return this.sent && this.cooldown === 0 && !this.resending;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    const emailField = this.form.getFieldProps("email");
    emailField.setValue(emailField.value.trim());
    const fullNameField = this.form.getFieldProps("fullName");
    fullNameField.setValue(fullNameField.value.trim());

    await this.form.onSubmit(async () => {
      this.error = null;
      this.submitting = true;
      try {
        await this.auth.register({
          email: this.form.email.trim(),
          password: this.form.password,
          ...(this.form.fullName.trim().length > 0
            ? { full_name: this.form.fullName.trim() }
            : {}),
        });
        this.registeredEmail = this.form.email.trim();
        this.sent = true;
        fullNameField.setValue("");
        this.form.getFieldProps("password").setValue("");
        this.form.getFieldProps("repeatPassword").setValue("");
        this.startCooldown();
      } catch (error) {
        this.error = registerErrorMessage(error);
      } finally {
        this.submitting = false;
      }
    })(event);
  }

  async resend(): Promise<void> {
    if (!this.canResend) return;
    this.resending = true;
    this.resendNotice = null;
    this.resendError = null;
    try {
      await this.auth.resendVerification(this.registeredEmail);
      this.resendNotice = t("auth.register.resend.sent");
      this.startCooldown();
    } catch (error) {
      this.resendError = userMessage(error, t("auth.register.resend.failed"));
    } finally {
      this.resending = false;
    }
  }

  editEmail(): void {
    this.stopCooldown();
    this.cooldown = 0;
    this.sent = false;
    this.resendNotice = null;
    this.resendError = null;
    this.error = null;
  }

  goLogin(): void {
    this.stopCooldown();
    this.router.navigate("/login");
  }

  private startCooldown(): void {
    this.clock.start();
  }

  private stopCooldown(): void {
    this.clock.stop();
  }
}

function registerErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "registration_disabled") {
      return t("auth.register.error.registrationDisabled");
    }
    if (error.code === "bad_request" && /password is too weak/i.test(error.message)) {
      return t("auth.register.error.passwordWeak");
    }
    return t("auth.register.error.failed");
  }
  return userMessage(error, t("auth.register.error.failed"));
}
