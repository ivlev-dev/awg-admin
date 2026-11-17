import { Show } from "@ivlev-dev/silent-core";

import type { ForgotPasswordVM } from "./ForgotPassword.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ForgotPassword(this: { vm: ForgotPasswordVM }) {
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
          <Show
            when={!this.vm.sent}
            fallback={
              <div class="stack">
                <div class="page-head" style="margin-bottom:8px">
                  <div class="page-head__eyebrow">{t("auth.forgot.eyebrow")}</div>
                  <h1>{t("auth.forgot.success.title")}</h1>
                  <p>{t("auth.forgot.success.text")}</p>
                </div>
                <div class="alert alert--info">{t("auth.forgot.success.note")}</div>
                <Show when={this.vm.resendError}>
                  <div class="alert alert--error">{this.vm.resendError}</div>
                </Show>
                <button class="btn btn--primary btn--block" type="button" disabled={!this.vm.canResend} onClick={() => this.vm.resend()}>
                  <Show
                    when={this.vm.resending}
                    fallback={
                      <span>
                        {this.vm.cooldown > 0
                          ? t("auth.forgot.resend.cooldown", { seconds: this.vm.cooldown })
                          : t("auth.forgot.resend")}
                      </span>
                    }
                  >
                    <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                    <span>{t("auth.forgot.submitting")}</span>
                  </Show>
                </button>
                <button class="btn btn--ghost btn--block" type="button" onClick={() => this.vm.goLogin()}>
                  {t("auth.forgot.backToLogin")}
                </button>
              </div>
            }
          >
            <div class="page-head" style="margin-bottom:24px">
              <div class="page-head__eyebrow">{t("auth.forgot.eyebrow")}</div>
              <h1>{t("auth.forgot.title")}</h1>
              <p>{t("auth.forgot.subtitle")}</p>
            </div>

            <form class="stack" onSubmit={(event: Event) => this.vm.submit(event)}>
              <div class="field">
                <label for="forgot-email">{t("auth.forgot.email")}</label>
                <input
                  id="forgot-email"
                  class={`input ${this.vm.email.length > 0 && !this.vm.emailValid ? "is-invalid" : ""}`}
                  type="email"
                  autocomplete="email"
                  placeholder={t("auth.forgot.emailPlaceholder")}
                  value={this.vm.email}
                  onInput={(event: Event) => this.vm.setEmail(event)}
                />
                <Show when={this.vm.email.length > 0 && !this.vm.emailValid}>
                  <div class="hint" style="color:var(--red)">{t("auth.forgot.error.email")}</div>
                </Show>
              </div>

              <Show when={this.vm.error}>
                <div class="alert alert--error">{this.vm.error}</div>
              </Show>

              <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSubmit}>
                <Show when={this.vm.submitting} fallback={<span>{t("auth.forgot.submit")}</span>}>
                  <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                  <span>{t("auth.forgot.submitting")}</span>
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
        </div>
      </section>
    </div>
  );
}
