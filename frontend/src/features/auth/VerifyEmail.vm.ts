import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import type { AuthService } from "../../application/auth/service";
import { userMessage } from "@/application/errors";
import { t } from "@/i18n";

export type VerifyEmailStatus = "loading" | "success" | "error";

export class VerifyEmailVM {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  @reactive accessor status: VerifyEmailStatus = "loading";
  @reactive accessor error: string | null = null;

  private started = false;

  created(): void {
    void this.verify();
  }

  @computed
  get token(): string {
    return new URLSearchParams(this.router.search).get("token")?.trim() ?? "";
  }

  async verify(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.status = "loading";
    this.error = null;
    const token = this.token;
    if (!token) {
      this.status = "error";
      this.error = t("auth.verify.error.missing");
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      this.status = "success";
    } catch (error) {
      this.status = "error";
      this.error = userMessage(error, t("auth.verify.error.failed"));
    }
  }

  goLogin(): void {
    this.router.navigate("/login");
  }
}
