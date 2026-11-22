import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import type { AuthService } from "@/application/auth/service";
import { userMessage } from "@/application/errors";
import { ApiError } from "@/domain/errors";
import { passwordPolicyIssue } from "@/domain/validation";
import { t } from "@/i18n";

import { ResetPasswordForm } from "./ResetPassword.form";

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
  readonly form = new ResetPasswordForm();

  @reactive accessor showPassword = false;
  @reactive accessor submitting = false;
  @reactive accessor status: ResetPasswordStatus = "form";
  @reactive accessor error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    super();
  }

  override created(): void {
    if (!this.token) {
      this.status = "invalid";
      this.error = t("auth.reset.error.missing");
    }
  }

  override unmounted(): void {
    this.form.dispose();
  }

  @computed
  get token(): string {
    return new URLSearchParams(this.router.search).get("token")?.trim() ?? "";
  }

  @computed
  get canSubmit(): boolean {
    if (this.status !== "form" || this.submitting) return false;
    const password = this.form.password;
    return (
      password.length > 0 &&
      passwordPolicyIssue(password) === null &&
      password === this.form.repeatPassword
    );
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    if (this.status !== "form") return;
    if (!this.token) {
      this.status = "invalid";
      this.error = t("auth.reset.error.missing");
      return;
    }

    await this.form.onSubmit(async () => {
      this.error = null;
      this.submitting = true;
      try {
        await this.auth.resetPassword(this.token, this.form.password);
        this.form.getFieldProps("password").setValue("");
        this.form.getFieldProps("repeatPassword").setValue("");
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
    })(event);
  }

  goLogin(): void {
    this.router.navigate("/login");
  }

  goForgotPassword(): void {
    this.router.navigate("/forgot-password");
  }
}
