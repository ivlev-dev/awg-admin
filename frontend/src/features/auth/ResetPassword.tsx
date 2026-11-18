import { Show } from "@ivlev-dev/silent-core";

import type { ResetPasswordVM } from "./ResetPassword.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ResetPassword(this: { vm: ResetPasswordVM }) {
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
          <Show when={this.vm.status === "form"}>
            <div class="page-head" style="margin-bottom:24px">
              <div class="page-head__eyebrow">{t("auth.reset.eyebrow")}</div>
              <h1>{t("auth.reset.title")}</h1>
              <p>{t("auth.reset.subtitle")}</p>
            </div>

            <form class="stack" onSubmit={(event: Event) => this.vm.submit(event)}>
              <div class="field">
                <label for="reset-password">{t("auth.reset.password")}</label>
                <div class="auth__password">
                  <input
                    id="reset-password"
                    class={`input ${this.vm.passwordTooShort ? "is-invalid" : ""}`}
                    type={this.vm.showPassword ? "text" : "password"}
                    autocomplete="new-password"
                    placeholder="••••••••"
                    value={this.vm.password}
                    onInput={(event: Event) => this.vm.setPassword(event)}
                  />
                  <button class="btn btn--ghost btn--icon" type="button" onClick={() => this.vm.togglePassword()} aria-label={t("auth.login.showPassword")} title={t("auth.login.showPassword")}>
                    <Icon name={this.vm.showPassword ? "shield" : "search"} size={16} class="" />
                  </button>
                </div>
                <Show
                  when={this.vm.passwordTooShort}
                  fallback={<div class="hint">{t("auth.reset.passwordHint")}</div>}
                >
                  <div class="hint" style="color:var(--red)">{t("auth.reset.error.password")}</div>
                </Show>
              </div>

              <div class="field">
                <label for="reset-repeat">{t("auth.reset.repeat")}</label>
                <input
                  id="reset-repeat"
                  class={`input ${this.vm.repeatMismatch ? "is-invalid" : ""}`}
                  type={this.vm.showPassword ? "text" : "password"}
                  autocomplete="new-password"
                  placeholder="••••••••"
                  value={this.vm.repeatPassword}
                  onInput={(event: Event) => this.vm.setRepeatPassword(event)}
                />
                <Show when={this.vm.repeatMismatch}>
                  <div class="hint" style="color:var(--red)">{t("auth.reset.error.mismatch")}</div>
                </Show>
              </div>

              <Show when={this.vm.error}>
                <div class="alert alert--error">{this.vm.error}</div>
              </Show>

              <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSubmit}>
                <Show when={this.vm.submitting} fallback={<span>{t("auth.reset.submit")}</span>}>
                  <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                  <span>{t("auth.reset.submitting")}</span>
                </Show>
              </button>
            </form>

            <div class="auth__footer">
              <div class="row-between wrap">
                <span class="xs muted">{t("auth.login.footer")}</span>
                <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.goLogin()}>
                  {t("auth.forgot.backToLogin")}
                </button>
              </div>
            </div>
          </Show>

          <Show when={this.vm.status === "success"}>
            <div class="page-head" style="margin-bottom:8px">
              <div class="page-head__eyebrow">{t("auth.reset.eyebrow")}</div>
              <h1>{t("auth.reset.success.title")}</h1>
            </div>
            <div class="stack">
              <div class="alert alert--info">{t("auth.reset.success.text")}</div>
              <button class="btn btn--primary btn--block" type="button" onClick={() => this.vm.goLogin()}>
                <Icon name="check" size={16} class="" /> {t("auth.reset.login")}
              </button>
            </div>
          </Show>

          <Show when={this.vm.status === "invalid"}>
            <div class="page-head" style="margin-bottom:8px">
              <div class="page-head__eyebrow">{t("auth.reset.eyebrow")}</div>
              <h1>{t("auth.reset.invalid.title")}</h1>
            </div>
            <div class="stack">
              <div class="alert alert--error">{this.vm.error ?? t("auth.reset.error.invalidToken")}</div>
              <button class="btn btn--primary btn--block" type="button" onClick={() => this.vm.goForgotPassword()}>
                {t("auth.reset.requestNew")}
              </button>
              <button class="btn btn--ghost btn--block" type="button" onClick={() => this.vm.goLogin()}>
                {t("auth.reset.login")}
              </button>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
