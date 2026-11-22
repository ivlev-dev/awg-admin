import { Show } from "@ivlev-dev/silent-core";

import type { LoginVM } from "./Login.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function Login(this: { vm: LoginVM }) {
  const email = this.vm.form.getFieldProps("email");
  const password = this.vm.form.getFieldProps("password");
  const totpCode = this.vm.form.getFieldProps("totpCode");

  return (
    <div class="auth">
      <section class="auth__brand">
        <div class="auth__brand-glow"></div>
        <div class="auth__brand-inner">
          <div class="row" style="gap:14px">
            <div class="sidebar__logo" style="width:52px;height:52px"></div>
            <div>
              <div class="sidebar__title" style="font-size:1.35rem">AWG Admin</div>
              <div class="sidebar__subtitle">{t("shell.subtitle")}</div>
            </div>
          </div>
          <div style="margin-top:auto" class="stack">
            <h2 style="color:#fff;font-size:clamp(1.6rem,1.2rem+1.6vw,2.4rem);letter-spacing:-0.03em;line-height:1.12">
              {t("auth.brand.headline.first")}<br />{t("auth.brand.headline.second")}
            </h2>
            <p style="color:var(--sidebar-muted);max-width:42ch">
              {t("auth.brand.tagline")}
            </p>
            <div class="auth__features">
              <div class="auth__feature"><Icon name="shield" size={18} class="" />{t("auth.brand.feature.awg")}</div>
              <div class="auth__feature"><Icon name="traffic" size={18} class="" />{t("auth.brand.feature.traffic")}</div>
              <div class="auth__feature"><Icon name="globe" size={18} class="" />{t("auth.brand.feature.import")}</div>
            </div>
          </div>
          <div class="xs" style="color:var(--sidebar-muted);margin-top:32px">{t("auth.brand.version")}</div>
        </div>
      </section>

      <section class="auth__form">
        <div class="auth__card">
          <div class="page-head" style="margin-bottom:24px">
            <div class="page-head__eyebrow">{t("auth.login.eyebrow")}</div>
            <h1>{this.vm.step === "totp" ? t("auth.login.totp.title") : t("auth.login.title")}</h1>
            <p>{this.vm.step === "totp" ? t("auth.login.totp.subtitle") : t("auth.login.subtitle")}</p>
          </div>

          <form class="stack" onSubmit={(event: Event) => this.vm.submit(event)}>
            <Show when={this.vm.step === "credentials"}>
              <div class="field">
                <label for="email">{t("auth.login.identifier")}</label>
                <input
                  id="email"
                  class={`input ${email.error ? "is-invalid" : ""}`}
                  type="email"
                  autocomplete="email"
                  placeholder={t("auth.login.identifierPlaceholder")}
                  value={email.value}
                  aria-invalid={email.error !== undefined}
                  onInput={email.onInput}
                  onBlur={email.onBlur}
                />
                <Show when={email.error}>
                  <div class="hint" style="color:var(--red)">{email.error}</div>
                </Show>
              </div>
              <div class="field">
                <label for="password">{t("auth.login.password")}</label>
                <div class="auth__password">
                  <input
                    id="password"
                    class="input"
                    type={this.vm.showPassword ? "text" : "password"}
                    autocomplete="current-password"
                    placeholder="••••••••"
                    value={password.value}
                    onInput={password.onInput}
                    onBlur={password.onBlur}
                  />
                  <button class="btn btn--ghost btn--icon" type="button" onClick={() => this.vm.togglePassword()} aria-label={t("auth.login.showPassword")} title={t("auth.login.showPassword")}>
                    <Icon name={this.vm.showPassword ? "shield" : "search"} size={16} class="" />
                  </button>
                </div>
                <div class="row-between">
                  <span></span>
                  <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.goForgotPassword()}>
                    {t("auth.login.forgotLink")}
                  </button>
                </div>
              </div>
            </Show>

            <Show when={this.vm.step === "totp"}>
              <div class="field">
                <label for="totp">{t("auth.login.totp.label")}</label>
                <input
                  id="totp"
                  class="input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder={t("auth.login.totp.placeholder")}
                  value={totpCode.value}
                  aria-invalid={totpCode.error !== undefined}
                  onInput={totpCode.onInput}
                  onBlur={totpCode.onBlur}
                />
                <Show when={totpCode.error} fallback={<div class="hint">{t("auth.login.totp.hint")}</div>}>
                  <div class="hint" style="color:var(--red)">{totpCode.error}</div>
                </Show>
              </div>
            </Show>

            <Show when={this.vm.error}>
              <div class="alert alert--error">{this.vm.error}</div>
            </Show>

            <Show when={this.vm.showResend}>
              <div class="stack-sm">
                <button class="btn btn--sm" type="button" disabled={!this.vm.canResend} onClick={() => this.vm.resend()}>
                  <Icon name={this.vm.resending ? "refresh" : "link"} size={14} class="" />
                  {this.vm.resending ? t("auth.login.resend.sending") : t("auth.login.resend")}
                </button>
                <Show when={this.vm.resendNotice}>
                  <div class="alert alert--info">{this.vm.resendNotice}</div>
                </Show>
                <Show when={this.vm.resendError}>
                  <div class="alert alert--error">{this.vm.resendError}</div>
                </Show>
              </div>
            </Show>

            <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSubmit}>
              <Show when={this.vm.busy} fallback={<span>{this.vm.step === "totp" ? t("auth.login.totp.submit") : t("auth.login.submit")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("auth.login.submitting")}</span>
              </Show>
            </button>

            <Show when={this.vm.step === "totp"}>
              <button class="btn btn--ghost btn--block" type="button" onClick={() => this.vm.backToCredentials()} disabled={this.vm.busy}>
                {t("auth.login.totp.back")}
              </button>
            </Show>
          </form>

          <div class="auth__footer">
            <Show
              when={this.vm.step === "credentials"}
              fallback={<span class="xs muted">{t("auth.login.footer")}</span>}
            >
              <div class="row-between wrap">
                <span class="xs muted">{t("auth.login.footer")}</span>
                <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.goRegister()}>
                  {t("auth.login.registerLink")}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </section>
    </div>
  );
}
