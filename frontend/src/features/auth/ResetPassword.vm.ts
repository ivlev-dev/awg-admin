import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

export type ResetPasswordStatus = "form" | "success" | "invalid";

const PASSWORD_MIN_LENGTH = 8;
const INVALID_TOKEN_CODES: ReadonlySet<string> = new Set([
  "invalid_token",
  "token_expired",
  "expired",
]);

interface CodedError {
  readonly code?: unknown;
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as CodedError;
  return typeof candidate.code === "string" ? candidate.code : "";
}

export class ResetPasswordVM {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  @reactive accessor password = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor showPassword = false;
  @reactive accessor submitting = false;
  @reactive accessor status: ResetPasswordStatus = "form";
  @reactive accessor error: string | null = null;

  created(): void {
    if (!this.token) {
      this.status = "invalid";
      this.error = t("auth.reset.error.missing");
    }
  }

  @computed
  get token(): string {
    return new URLSearchParams(this.router.search).get("token")?.trim() ?? "";
  }

  @computed
  get passwordTooShort(): boolean {
    return this.password.length > 0 && this.password.length < PASSWORD_MIN_LENGTH;
  }

  @computed
  get repeatMismatch(): boolean {
    return this.repeatPassword.length > 0 && this.password !== this.repeatPassword;
  }

  @computed
  get canSubmit(): boolean {
    return (
      this.status === "form" &&
      !this.submitting &&
      this.password.length >= PASSWORD_MIN_LENGTH &&
      this.password === this.repeatPassword
    );
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
    this.error = null;
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
    if (!this.token) {
      this.status = "invalid";
      this.error = t("auth.reset.error.missing");
      return;
    }
    if (this.password.length < PASSWORD_MIN_LENGTH) {
      this.error = t("auth.reset.error.password");
      return;
    }
    if (this.password !== this.repeatPassword) {
      this.error = t("auth.reset.error.mismatch");
      return;
    }
    this.error = null;
    this.submitting = true;
    try {
      await this.auth.resetPassword(this.token, this.password);
      this.password = "";
      this.repeatPassword = "";
      this.status = "success";
    } catch (error) {
      if (INVALID_TOKEN_CODES.has(errorCode(error))) {
        this.status = "invalid";
        this.error = t("auth.reset.error.invalidToken");
      } else {
        this.error = userMessage(error, t("auth.reset.error.failed"));
      }
    } finally {
      this.submitting = false;
    }
  }

  goLogin(): void {
    this.router.navigate("/login");
  }

  goForgotPassword(): void {
    this.router.navigate("/forgot-password");
  }
}
