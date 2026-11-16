import { For, Show } from "@ivlev-dev/silent-core";

import type { ProfilePageVM } from "./ProfilePage.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { t } from "@/i18n";

export function ProfilePage(this: { vm: ProfilePageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("profile.eyebrow")}</div>
        <h1>{t("profile.title")}</h1>
        <p>{t("profile.subtitle")}</p>
      </div>

      <div class="profile-layout">
        <div class="stack">
          <section class="card">
            <div class="card__body stack">
              <div class="row" style="gap:16px">
                <div
                  class="avatar avatar--lg"
                  style="width:72px;height:72px;border-radius:22px;font-size:1.7rem"
                >
                  {this.vm.userInitial}
                </div>
                <div class="grow">
                  <div class="row wrap" style="gap:8px">
                    <div class="strong" style="font-size:var(--t-lg)">{this.vm.login}</div>
                    <span class={this.vm.roleBadgeClass}>{this.vm.roleLabel}</span>
                  </div>
                  <div class="xs muted">
                    ID: <span class="mono">{this.vm.userId}</span>
                  </div>
                  <div class="xs muted">{t("profile.memberSince", { date: this.vm.createdAtLabel })}</div>
                </div>
              </div>

              <hr class="divider" />

              <div class="stack-sm">
                <div class="xs muted" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:700">
                  {t("profile.permissions")}
                </div>
                <For each={this.vm.permissions}>
                  {(permission) => (
                    <div class="row" style="gap:10px;align-items:flex-start">
                      <span
                        style={permission.granted ? "color:var(--green);display:inline-flex;margin-top:2px" : "color:var(--muted-2);display:inline-flex;margin-top:2px"}
                      >
                        <Icon name={permission.granted ? "check" : "close"} size={16} class="" />
                      </span>
                      <div class="grow">
                        <div class="small strong">{permission.label}</div>
                        <div class="xs muted">{permission.description}</div>
                      </div>
                      <span class={`badge ${permission.granted ? "badge--green" : "badge--red"}`}>
                        {permission.granted ? t("profile.permissions.granted") : t("profile.permissions.denied")}
                      </span>
                    </div>
                  )}
                </For>
                <div class="xs muted" style="margin-top:var(--sp-2)">
                  {t("profile.permissions.note")}
                </div>
              </div>

              <hr class="divider" />

              <button class="btn btn--danger btn--block" type="button" onClick={() => this.vm.logout()}>
                <Icon name="logout" size={16} class="" /> {t("profile.logout")}
              </button>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">{t("quota.title")}</div>
                <div class="card__sub">{t("quota.period", { period: this.vm.quotaPeriodLabel })}</div>
              </div>
              <span
                class={`badge ${
                  this.vm.quotaView.exceeded
                    ? "badge--red"
                    : this.vm.quotaView.hasQuota
                      ? "badge--green"
                      : "badge--blue"
                }`}
              >
                {this.vm.quotaStatusLabel}
              </span>
            </div>
            <div class="card__body">
              <Show
                when={!this.vm.quotaLoading}
                fallback={<div class="skeleton" style="height:64px"></div>}
              >
                <Show
                  when={this.vm.quota}
                  fallback={
                    <div class="small muted">
                      {this.vm.quotaError ?? t("common.unlimited")}
                    </div>
                  }
                >
                  <div class="quota">
                    <div class="row-between wrap">
                      <div class="quota__value">
                        {this.vm.quotaUsedLabel}
                        <span class="muted"> {t("quota.of", { limit: this.vm.quotaLimitLabel })}</span>
                      </div>
                      <div class="mono strong">{this.vm.quotaView.percentLabel}</div>
                    </div>
                    <Show when={this.vm.quotaView.hasQuota}>
                      <div class="progress">
                        <div
                          class={this.vm.quotaView.progressClass}
                          style={`width:${this.vm.quotaView.progress}%`}
                        ></div>
                      </div>
                    </Show>
                    <div class="row-between wrap xs muted">
                      <span>
                        {t("quota.remaining", { value: this.vm.quotaRemainingLabel })}
                      </span>
                      <span>{t("quota.reset", { date: this.vm.quotaResetLabel })}</span>
                    </div>
                  </div>
                  <Show when={this.vm.quotaView.exceeded}>
                    <div class="alert alert--error" style="margin-top:var(--sp-3)">
                      {t("quota.exceededNotice")}
                    </div>
                  </Show>
                </Show>
              </Show>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">{t("profile.theme.title")}</div>
                <div class="card__sub">{t("profile.theme.subtitle")}</div>
              </div>
              <span class="badge badge--blue">{t("profile.theme.current", { theme: this.vm.effectiveThemeLabel })}</span>
            </div>
            <div class="card__body stack-sm">
              <div class="tabs">
                <For each={this.vm.themeOptions}>
                  {(option) => (
                    <button
                      class={`tab ${this.vm.isTheme(option.value) ? "is-active" : ""}`}
                      type="button"
                      onClick={() => this.vm.setTheme(option.value)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
              <For each={this.vm.themeOptions}>
                {(option) => (
                  <Show when={this.vm.isTheme(option.value)}>
                    <div class="xs muted">{option.description}</div>
                  </Show>
                )}
              </For>
              <div class="xs muted">
                {t("profile.theme.note")}
              </div>

              <hr class="divider" />

              <div class="stack-sm">
                <div class="strong">{t("language.title")}</div>
                <div class="xs muted">{t("language.subtitle")}</div>
                <div class="tabs">
                  <For each={this.vm.languageOptions}>
                    {(option) => (
                      <button
                        class={`tab ${this.vm.isLanguage(option.value) ? "is-active" : ""}`}
                        type="button"
                        onClick={() => this.vm.setLanguage(option.value)}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">{t("profile.totp.title")}</div>
                <div class="card__sub">{t("profile.totp.subtitle")}</div>
              </div>
              <span class={this.vm.totpStatusBadge}>{this.vm.totpStatusLabel}</span>
            </div>
            <div class="card__body stack-sm">
              <div class="small muted">
                {this.vm.totpEnabled ? t("profile.totp.enabledNote") : t("profile.totp.disabledNote")}
              </div>
              <button
                class={`btn btn--block ${this.vm.totpEnabled ? "btn--danger" : "btn--primary"}`}
                type="button"
                onClick={() => this.vm.toggleTotp()}
              >
                <Icon name="shield" size={16} class="" />
                {this.vm.totpEnabled ? t("profile.totp.disable") : t("profile.totp.enable")}
              </button>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">{t("profile.account.title")}</div>
              <div class="card__sub">{t("profile.account.subtitle")}</div>
            </div>
          </div>
          <form class="card__body stack" onSubmit={(event: SubmitEvent) => this.vm.savePassword(event)}>
            <div class="field">
              <label for="profile-login">{t("profile.account.login")}</label>
              <input
                id="profile-login"
                class="input"
                type="text"
                value={this.vm.login}
                readonly
                autocomplete="username"
              />
              <div class="hint">{t("profile.account.loginHint")}</div>
            </div>

            <hr class="divider" />

            <div class="stack-sm">
              <div class="strong">{t("profile.password.title")}</div>
              <div class="xs muted">{t("profile.password.subtitle")}</div>
            </div>

            <div class="field">
              <label for="profile-current">{t("profile.password.current")}</label>
              <input
                id="profile-current"
                class="input"
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
                value={this.vm.currentPassword}
                onInput={(event: InputEvent) => this.vm.setCurrentPassword(event)}
              />
            </div>

            <div class="field">
              <label for="profile-next">{t("profile.password.next")}</label>
              <input
                id="profile-next"
                class={`input ${this.vm.nextTooShort ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                placeholder={t("profile.password.nextPlaceholder")}
                value={this.vm.nextPassword}
                onInput={(event: InputEvent) => this.vm.setNextPassword(event)}
              />
              <Show
                when={this.vm.nextTooShort}
                fallback={<div class="hint">{t("profile.password.hint")}</div>}
              >
                <div class="hint" style="color:var(--red)">{t("profile.password.tooShort")}</div>
              </Show>
            </div>

            <div class="field">
              <label for="profile-repeat">{t("profile.password.repeat")}</label>
              <input
                id="profile-repeat"
                class={`input ${this.vm.repeatMismatch ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                placeholder={t("profile.password.repeatPlaceholder")}
                value={this.vm.repeatPassword}
                onInput={(event: InputEvent) => this.vm.setRepeatPassword(event)}
              />
              <Show when={this.vm.repeatMismatch}>
                <div class="hint" style="color:var(--red)">{t("profile.password.mismatch")}</div>
              </Show>
            </div>

            <button class="btn btn--primary btn--block" type="submit" disabled={!this.vm.canSave}>
              <Show when={this.vm.saving} fallback={<span>{t("common.save")}</span>}>
                <span
                  class="spinner"
                  style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"
                ></span>
                <span>{t("common.saving")}</span>
              </Show>
            </button>

            <div class="xs muted">{t("profile.password.note")}</div>
          </form>
        </section>
      </div>

      <Modal
        open={this.vm.totpOpen}
        title={t("profile.totp.modal.enableTitle")}
        onClose={() => this.vm.closeTotpSetup()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeTotpSetup()} disabled={this.vm.totpSaving}>
              {t("profile.totp.modal.cancel")}
            </button>
            <button class="btn btn--primary" type="button" onClick={() => this.vm.submitTotpEnable()} disabled={!this.vm.canEnableTotp}>
              <Show when={this.vm.totpSaving} fallback={<span>{t("profile.totp.modal.confirm")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("common.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <Show
            when={!this.vm.totpSetupLoading}
            fallback={
              <div class="stack" style="align-items:center;gap:10px;padding:16px 0">
                <div class="spinner"></div>
                <div class="small muted">{t("profile.totp.loading")}</div>
              </div>
            }
          >
            <Show when={this.vm.totpSetupError}>
              <div class="alert alert--error">{this.vm.totpSetupError}</div>
            </Show>
            <Show when={this.vm.totpSetup}>
              <div class="field">
                <label>{t("profile.totp.modal.secret")}</label>
                <div class="copy-row">
                  <input class="input" type="text" readonly value={this.vm.totpSetup?.secret ?? ""} />
                </div>
                <div class="hint">{t("profile.totp.modal.secretHint")}</div>
              </div>
              <div class="field">
                <label>{t("profile.totp.modal.uri")}</label>
                <div class="copy-row">
                  <input class="input" type="text" readonly value={this.vm.totpSetup?.otpauth_url ?? ""} />
                </div>
                <div class="hint">
                  <a href={this.vm.totpSetup?.otpauth_url ?? "#"}>{t("profile.totp.modal.uriHint")}</a>
                </div>
              </div>
              <div class="field">
                <div class="row-between wrap">
                  <label>{t("profile.totp.modal.recovery")}</label>
                  <button class="btn btn--sm" type="button" onClick={() => this.vm.copyRecoveryCodes()}>
                    <Icon name="copy" size={14} class="" /> {t("profile.totp.modal.copy")}
                  </button>
                </div>
                <div class="stack-sm" style="font-family:ui-monospace,Menlo,Consolas,monospace">
                  <For each={this.vm.totpSetup?.recovery_codes ?? []}>
                    {(code) => <div class="small strong">{code}</div>}
                  </For>
                </div>
                <div class="hint">{t("profile.totp.modal.recoveryHint")}</div>
              </div>
              <div class="field">
                <label for="totp-enable-code">{t("profile.totp.modal.code")}</label>
                <input
                  id="totp-enable-code"
                  class="input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder={t("profile.totp.modal.codePlaceholder")}
                  value={this.vm.totpCode}
                  onInput={(event: Event) => this.vm.setTotpCode(event)}
                />
              </div>
            </Show>
          </Show>
        </div>
      </Modal>

      <Modal
        open={this.vm.totpDisableOpen}
        title={t("profile.totp.modal.disableTitle")}
        onClose={() => this.vm.closeTotpDisable()}
        footer={
          <div class="row" style="gap:8px">
            <button class="btn" type="button" onClick={() => this.vm.closeTotpDisable()} disabled={this.vm.totpDisableSaving}>
              {t("profile.totp.modal.cancel")}
            </button>
            <button class="btn btn--danger" type="button" onClick={() => this.vm.submitTotpDisable()} disabled={!this.vm.canDisableTotp}>
              <Show when={this.vm.totpDisableSaving} fallback={<span>{t("profile.totp.modal.disableConfirm")}</span>}>
                <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                <span>{t("common.saving")}</span>
              </Show>
            </button>
          </div>
        }
      >
        <div class="stack">
          <div class="small muted">{t("profile.totp.modal.disableHint")}</div>
          <div class="field">
            <label for="totp-disable-password">{t("profile.totp.modal.password")}</label>
            <input
              id="totp-disable-password"
              class="input"
              type="password"
              autocomplete="current-password"
              value={this.vm.totpDisablePassword}
              onInput={(event: Event) => this.vm.setTotpDisablePassword(event)}
            />
          </div>
          <div class="field">
            <label for="totp-disable-code">{t("profile.totp.modal.code")}</label>
            <input
              id="totp-disable-code"
              class="input"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder={t("profile.totp.modal.codePlaceholder")}
              value={this.vm.totpDisableCode}
              onInput={(event: Event) => this.vm.setTotpDisableCode(event)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
