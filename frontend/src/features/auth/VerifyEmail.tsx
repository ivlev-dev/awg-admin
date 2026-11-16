import { Show } from "@ivlev-dev/silent-core";

import type { VerifyEmailVM } from "./VerifyEmail.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function VerifyEmail(this: { vm: VerifyEmailVM }) {
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
          </div>
          <div class="xs" style="color:var(--sidebar-muted);margin-top:32px">{t("auth.brand.version")}</div>
        </div>
      </section>

      <section class="auth__form">
        <div class="auth__card">
          <div class="page-head" style="margin-bottom:24px">
            <div class="page-head__eyebrow">{t("auth.verify.eyebrow")}</div>
            <h1>{t("auth.verify.title")}</h1>
          </div>

          <Show when={this.vm.status === "loading"}>
            <div class="stack" style="align-items:center;gap:12px;padding:24px 0">
              <div class="spinner"></div>
              <div class="small muted">{t("auth.verify.loading")}</div>
            </div>
          </Show>

          <Show when={this.vm.status === "success"}>
            <div class="stack">
              <div class="alert alert--info">{t("auth.verify.success.text")}</div>
              <button class="btn btn--primary btn--block" type="button" onClick={() => this.vm.goLogin()}>
                <Icon name="check" size={16} class="" /> {t("auth.verify.login")}
              </button>
            </div>
          </Show>

          <Show when={this.vm.status === "error"}>
            <div class="stack">
              <div class="alert alert--error">{this.vm.error ?? t("auth.verify.error.failed")}</div>
              <button class="btn btn--primary btn--block" type="button" onClick={() => this.vm.goLogin()}>
                {t("auth.verify.login")}
              </button>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
