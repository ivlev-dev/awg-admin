import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Cooldown } from "@/app/cooldown";
import { Router } from "@/app/router";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

import { EMAIL_PATTERN, ForgotPasswordForm } from "./ForgotPassword.form";

const COOLDOWN_SECONDS = 60;

export class ForgotPasswordVM extends ViewModel {
  readonly form = new ForgotPasswordForm();

  @reactive accessor submitting = false;
  @reactive accessor resending = false;
  @reactive accessor sent = false;
  @reactive accessor cooldown = 0;
  @reactive accessor error: string | null = null;
  @reactive accessor resendError: string | null = null;

  private readonly clock = new Cooldown(COOLDOWN_SECONDS, (remaining) => {
    this.cooldown = remaining;
  });

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    super();
  }

  override unmounted(): void {
    this.stopCooldown();
    this.form.dispose();
  }

  @computed
  get canSubmit(): boolean {
    return !this.submitting && EMAIL_PATTERN.test(this.form.email.trim());
  }

  @computed
  get canResend(): boolean {
    return this.sent && this.cooldown === 0 && !this.resending;
  }

  async submit(event: Event): Promise<void> {
    const emailField = this.form.getFieldProps("email");
    emailField.setValue(emailField.value.trim());

    await this.form.onSubmit(async () => {
      this.error = null;
      this.resendError = null;
      this.submitting = true;
      try {
        await this.auth.forgotPassword(this.form.email);
        this.sent = true;
        this.startCooldown();
      } catch (error) {
        this.error = userMessage(error, t("auth.forgot.error.failed"));
      } finally {
        this.submitting = false;
      }
    })(event);
  }

  async resend(): Promise<void> {
    if (!this.canResend) return;
    this.resending = true;
    this.resendError = null;
    try {
      await this.auth.forgotPassword(this.form.email);
      this.startCooldown();
    } catch (error) {
      this.resendError = userMessage(error, t("auth.forgot.error.failed"));
    } finally {
      this.resending = false;
    }
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
