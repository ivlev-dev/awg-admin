import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { ApiError } from "@/domain/errors";
import { passwordPolicyIssue } from "@/domain/validation";
import { t } from "@/i18n";

export type ResetPasswordStatus = "form" | "success" | "invalid";

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

export class ResetPasswordVM extends ViewModel {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    super();
  }

  @reactive accessor password = "";
  @reactive accessor repeatPassword = "";
  @reactive accessor showPassword = false;
  @reactive accessor submitting = false;
  @reactive accessor status: ResetPasswordStatus = "form";
  @reactive accessor error: string | null = null;

  override created(): void {
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
    return this.password.length > 0 && passwordPolicyIssue(this.password) === "short";
  }

  @computed
  get passwordError(): string | null {
    switch (passwordPolicyIssue(this.password)) {
      case "short":
        return t("auth.reset.error.password");
      case "long":
        return t("auth.reset.error.passwordTooLong");
      case "common":
        return t("auth.reset.error.passwordWeak");
      default:
        return null;
    }
  }

  @computed
  get passwordInvalid(): boolean {
    return this.password.length > 0 && this.passwordError !== null;
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
      this.password.length > 0 &&
      this.passwordError === null &&
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
    const passwordError = this.passwordError;
    if (passwordError !== null) {
      this.error = passwordError;
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
      } else if (
        error instanceof ApiError &&
        error.code === "bad_request" &&
        /password is too weak/i.test(error.message)
      ) {
        this.error = t("auth.reset.error.passwordWeak");
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
