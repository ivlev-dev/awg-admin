import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { Session } from "@/app/session";

export class LoginVM {
  constructor(
    private readonly session: Session,
    private readonly router: Router,
  ) {}

  @reactive accessor login = "";
  @reactive accessor password = "";
  @reactive accessor showPassword = false;

  created(): void {
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
    return this.session.error;
  }

  @computed
  get canSubmit(): boolean {
    return this.login.trim().length > 0 && this.password.length > 0 && !this.busy;
  }

  setLogin(event: Event): void {
    this.login = (event.target as HTMLInputElement).value;
  }

  setPassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit) return;
    const success = await this.session.login(this.login.trim(), this.password);
    if (success) {
      this.router.replace("/");
    }
  }
}
