import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export class RegisterVM extends ViewModel {
  constructor(
    private readonly auth: AuthService,
    private readonly session: Session,
    private readonly router: Router,
  ) {
    super();
  }

  @reactive accessor email = "";
  @reactive accessor password = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor showPassword = false;
  @reactive accessor submitting = false;
  @reactive accessor error: string | null = null;
  @reactive accessor sent = false;
  @reactive accessor registeredEmail = "";
  @reactive accessor cooldown = 0;
  @reactive accessor resending = false;
  @reactive accessor resendNotice: string | null = null;
  @reactive accessor resendError: string | null = null;

  private timer: number | null = null;

  override created(): void {
    if (this.session.authenticated) {
      this.router.replace("/");
    }
  }

  override unmounted(): void {
    this.stopCooldown();
  }

  @computed
  get emailValid(): boolean {
    return EMAIL_PATTERN.test(this.email.trim());
  }

  @computed
  get passwordTooShort(): boolean {
    return this.password.length > 0 && this.password.length < 8;
  }

  @computed
  get repeatMismatch(): boolean {
    return this.repeatPassword.length > 0 && this.password !== this.repeatPassword;
  }

  @computed
  get canSubmit(): boolean {
    return (
      !this.submitting &&
      this.emailValid &&
      this.password.length >= 8 &&
      this.password === this.repeatPassword
    );
  }

  @computed
  get canResend(): boolean {
    return this.sent && this.cooldown === 0 && !this.resending;
  }

  setEmail(event: Event): void {
    this.email = (event.target as HTMLInputElement).value;
    this.error = null;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  setRepeatPassword(event: Event): void {
    this.repeatPassword = (event.target as HTMLInputElement).value;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting) return;
    if (!this.emailValid) {
      this.error = t("auth.register.error.email");
      return;
    }
    if (this.password.length < 8) {
      this.error = t("auth.register.error.password");
      return;
    }
    if (this.password !== this.repeatPassword) {
      this.error = t("auth.register.error.mismatch");
      return;
    }
    this.error = null;
    this.submitting = true;
    try {
      await this.auth.register({
        email: this.email.trim(),
        password: this.password,
      });
      this.registeredEmail = this.email.trim();
      this.sent = true;
      this.password = "";
      this.repeatPassword = "";
      this.startCooldown();
    } catch (error) {
      this.error = userMessage(error, t("auth.register.error.failed"));
    } finally {
      this.submitting = false;
    }
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
