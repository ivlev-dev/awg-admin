import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export class ForgotPasswordVM {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  @reactive accessor email = "";
  @reactive accessor submitting = false;
  @reactive accessor resending = false;
  @reactive accessor sent = false;
  @reactive accessor cooldown = 0;
  @reactive accessor error: string | null = null;
  @reactive accessor resendError: string | null = null;

  private timer: number | null = null;

  @computed
  get emailValid(): boolean {
    return EMAIL_PATTERN.test(this.email.trim());
  }

  @computed
  get canSubmit(): boolean {
    return !this.submitting && this.emailValid;
  }

  @computed
  get canResend(): boolean {
    return this.sent && this.cooldown === 0 && !this.resending;
  }

  setEmail(event: Event): void {
    this.email = (event.target as HTMLInputElement).value;
    this.error = null;
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting) return;
    if (!this.emailValid) {
      this.error = t("auth.forgot.error.email");
      return;
    }
    this.error = null;
    this.resendError = null;
    this.submitting = true;
    try {
      await this.auth.forgotPassword(this.email.trim());
      this.email = this.email.trim();
      this.sent = true;
      this.startCooldown();
    } catch (error) {
      this.error = userMessage(error, t("auth.forgot.error.failed"));
    } finally {
      this.submitting = false;
    }
  }

  async resend(): Promise<void> {
    if (!this.canResend) return;
    this.resending = true;
    this.resendError = null;
    try {
      await this.auth.forgotPassword(this.email);
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
    this.stopCooldown();
    this.cooldown = COOLDOWN_SECONDS;
    this.timer = window.setInterval(() => {
      if (this.cooldown <= 1) {
        this.cooldown = 0;
        this.stopCooldown();
        return;
      }
      this.cooldown -= 1;
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
