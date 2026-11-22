import { For, Show } from "@ivlev-dev/silent-core";

import type { ProfilePageVM } from "./ProfilePage.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { QrCode } from "@/components/QrCode";
import { SkeletonTable } from "@/components/Skeleton";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/validation";
import { t } from "@/i18n";

export function ProfilePage(this: { vm: ProfilePageVM }) {
  const fullNameField = this.vm.fullNameForm.getFieldProps("fullName");
  const currentPasswordField = this.vm.passwordForm.getFieldProps("currentPassword");
  const nextPasswordField = this.vm.passwordForm.getFieldProps("nextPassword");
  const repeatPasswordField = this.vm.passwordForm.getFieldProps("repeatPassword");
  const totpSetupPasswordField = this.vm.totpSetupForm.getFieldProps("password");
  const totpCodeField = this.vm.totpEnableForm.getFieldProps("code");
  const totpDisablePasswordField = this.vm.totpDisableForm.getFieldProps("password");
  const totpDisableCodeField = this.vm.totpDisableForm.getFieldProps("code");

  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("profile.eyebrow")}</div>
        <h1>{t("profile.title")}</h1>
        <p>{t("profile.subtitle")}</p>
      </div>

      <div class="profile-layout">
        <div class="stack">
          <section class="card card--elevated">
            <div class="card__body stack">
              <div class="row" style="gap:16px">
                <span
                  class="cell-avatar"
                  style="width:72px;height:72px;border-radius:22px;font-size:1.7rem"
                  aria-hidden="true"
                >
                  {this.vm.userInitial}
                </span>
                <div class="grow">
                  <div class="row wrap" style="gap:8px">
                    <div class="strong" style="font-size:var(--t-lg)">{this.vm.fullName}</div>
                    <span class={this.vm.roleBadgeClass}>{this.vm.roleLabel}</span>
                    <button
                      class="btn btn--sm btn--ghost btn--icon"
                      type="button"
                      onClick={() => this.vm.startFullNameEdit()}
                      aria-label={t("profile.fullName.edit")}
                      title={t("profile.fullName.edit")}
                    >
                      <Icon name="edit" size={14} class="" />
                    </button>
                  </div>
                  <div class="small muted">{this.vm.email}</div>
                  <div class="xs muted">
                    ID: <span class="mono">{this.vm.userId}</span>
                  </div>
                  <div class="xs muted">{t("profile.memberSince", { date: this.vm.createdAtLabel })}</div>

                  <Show when={this.vm.editingFullName}>
                    <form class="stack-sm" style="margin-top:var(--sp-3)" onSubmit={(event: Event) => { void this.vm.saveFullName(event); }}>
                      <div class="field">
                        <label for="profile-full-name">{t("profile.fullName.label")}</label>
                        <input
                          id="profile-full-name"
                          class={`input ${fullNameField.error ? "is-invalid" : ""}`}
                          type="text"
                          autocomplete="name"
                          maxlength={200}
                          placeholder={t("profile.fullName.placeholder")}
                          value={fullNameField.value}
                          onInput={fullNameField.onInput}
                          onBlur={fullNameField.onBlur}
                          aria-invalid={fullNameField.error ? "true" : undefined}
                          aria-describedby={fullNameField.error ? "profile-full-name-error" : "profile-full-name-hint"}
                          data-autofocus
                        />
                        <Show
                          when={fullNameField.error}
                          fallback={<span class="hint" id="profile-full-name-hint">{t("profile.fullName.hint")}</span>}
                        >
                          <span class="field-error" id="profile-full-name-error" role="alert">{fullNameField.error}</span>
                        </Show>
                      </div>
                      <div class="row" style="gap:8px">
                        <button class="btn btn--primary btn--sm" type="submit" disabled={this.vm.savingFullName}>
                          {this.vm.savingFullName ? t("profile.fullName.saving") : t("profile.fullName.save")}
                        </button>
                        <button class="btn btn--sm" type="button" disabled={this.vm.savingFullName} onClick={() => this.vm.cancelFullNameEdit()}>
                          {t("common.cancelShort")}
                        </button>
                      </div>
                    </form>
                  </Show>
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

              <button class="btn btn--danger btn--block" type="button" disabled={this.vm.loggingOut} onClick={() => this.vm.logout()}>
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
                class={`status-chip ${
                  this.vm.quotaView.exceeded
                    ? "status-chip--error"
                    : this.vm.quotaView.hasQuota
                      ? "status-chip--ok"
                      : "status-chip--neutral"
                }`}
              >
                <span class="status-chip__dot"></span>
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

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">{t("profile.sessions.title")}</div>
                <div class="card__sub">{t("profile.sessions.subtitle")}</div>
              </div>
              <div class="row wrap" style="gap:8px">
                <button
                  class="btn btn--sm"
                  type="button"
                  disabled={this.vm.sessionsLoading}
                  onClick={() => this.vm.loadSessions()}
                >
                  <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
                </button>
                <button
                  class="btn btn--sm btn--danger"
                  type="button"
                  disabled={!this.vm.canRevokeAll}
                  onClick={() => this.vm.revokeAll()}
                >
                  {t("profile.sessions.revokeAll")}
                </button>
              </div>
            </div>
            <div
              class="card__body stack"
              aria-busy={this.vm.sessionsLoading ? "true" : "false"}
            >
              <Show when={this.vm.sessionsError}>
                <div class="alert alert--error">{this.vm.sessionsError}</div>
              </Show>
              <Show
                when={!this.vm.sessionsLoading}
                fallback={<SkeletonTable rows={3} columns={5} />}
              >
                <Show when={!this.vm.sessionsEmpty}>
                  <div class="list-toolbar">
                    <div class="field">
                      <label for="sessions-search">{t("profile.sessions.filter.search")}</label>
                      <input
                        id="sessions-search"
                        class="input"
                        type="search"
                        placeholder={t("profile.sessions.filter.searchPlaceholder")}
                        value={this.vm.sessionsSearch}
                        onInput={(event: InputEvent) => this.vm.setSessionsSearch(event)}
                      />
                    </div>
                    <label class="checkbox">
                      <input
                        type="checkbox"
                        checked={this.vm.sessionsOnlyActive}
                        onChange={(event: Event) => this.vm.setSessionsOnlyActive(event)}
                      />
                      <span>{t("profile.sessions.filter.onlyActive")}</span>
                    </label>
                    <Show when={this.vm.sessionsFilterActive}>
                      <button class="btn btn--sm" type="button" onClick={() => this.vm.resetSessionFilters()}>
                        {t("profile.sessions.filter.reset")}
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show
                  when={!this.vm.sessionsEmpty}
                  fallback={
                    <div class="empty">
                      <div class="empty__title">{t("profile.sessions.empty.title")}</div>
                      <div class="small">{t("profile.sessions.empty.text")}</div>
                    </div>
                  }
                >
                  <Show
                    when={!this.vm.filteredSessionsEmpty}
                    fallback={
                      <div class="empty">
                        <div class="empty__title">{t("profile.sessions.filter.empty.title")}</div>
                        <div class="small">{t("profile.sessions.filter.empty.text")}</div>
                      </div>
                    }
                  >
                    <div class="data-scroll table-wrap--cards">
                      <table class="table table--cards table--fixed table--sessions">
                        <thead>
                          <tr>
                            <th>{t("profile.sessions.column.device")}</th>
                            <th>{t("profile.sessions.column.ip")}</th>
                            <th>{t("profile.sessions.column.created")}</th>
                            <th>{t("profile.sessions.column.expires")}</th>
                            <th>{t("profile.sessions.column.status")}</th>
                            <th>{t("profile.sessions.column.actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={this.vm.filteredSessionRows}>
                            {(row) => (
                              <tr>
                                <td data-label={t("profile.sessions.column.device")}>
                                  <div class="cell-name">
                                    <span class="cell-avatar" aria-hidden="true">
                                      {row.device.charAt(0).toUpperCase()}
                                    </span>
                                    <span class="cell-name__text">
                                      <span class="strong" title={row.deviceTitle}>
                                        {row.device}
                                      </span>
                                    </span>
                                  </div>
                                </td>
                                <td data-label={t("profile.sessions.column.ip")}>
                                  <span class="small mono">{row.ip}</span>
                                </td>
                                <td data-label={t("profile.sessions.column.created")}>
                                  <span class="small nowrap mono">{row.createdLabel}</span>
                                </td>
                                <td data-label={t("profile.sessions.column.expires")}>
                                  <span class="small nowrap mono">{row.expiresLabel}</span>
                                </td>
                                <td data-label={t("profile.sessions.column.status")}>
                                  <span class={`badge ${row.statusClass}`}>{row.statusLabel}</span>
                                </td>
                                <td data-label={t("profile.sessions.column.actions")}>
                                  <button
                                    class="btn btn--icon btn--danger"
                                    type="button"
                                    aria-label={t("profile.sessions.revoke")}
                                    title={t("profile.sessions.revoke")}
                                    disabled={!row.revocable || row.busy || this.vm.sessionsBusy}
                                    onClick={() => this.vm.revokeSession(row.jti)}
                                  >
                                    <Icon name="trash" size={16} class="" />
                                  </button>
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </Show>
              </Show>

              <div class="xs muted">{t("profile.sessions.note")}</div>
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
              <label for="profile-email">{t("profile.account.email")}</label>
              <input
                id="profile-email"
                class="input"
                type="email"
                value={this.vm.email}
                readonly
                autocomplete="email"
              />
              <div class="hint">{t("profile.account.emailHint")}</div>
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
                class={`input ${currentPasswordField.error ? "is-invalid" : ""}`}
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
                value={currentPasswordField.value}
                onInput={currentPasswordField.onInput}
                onBlur={currentPasswordField.onBlur}
                aria-invalid={currentPasswordField.error ? "true" : undefined}
                aria-describedby={currentPasswordField.error ? "profile-current-error" : undefined}
              />
              <Show when={currentPasswordField.error}>
                <div class="hint" id="profile-current-error" style="color:var(--red)" role="alert">
                  {currentPasswordField.error}
                </div>
              </Show>
            </div>

            <div class="field">
              <label for="profile-next">{t("profile.password.next")}</label>
              <input
                id="profile-next"
                class={`input ${nextPasswordField.error ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                minlength={MIN_PASSWORD_LENGTH}
                maxlength={MAX_PASSWORD_LENGTH}
                placeholder={t("profile.password.nextPlaceholder")}
                value={nextPasswordField.value}
                onInput={nextPasswordField.onInput}
                onBlur={nextPasswordField.onBlur}
                aria-invalid={nextPasswordField.error ? "true" : undefined}
                aria-describedby={nextPasswordField.error ? "profile-next-error" : "profile-next-hint"}
              />
              <Show
                when={nextPasswordField.error}
                fallback={<div class="hint" id="profile-next-hint">{t("profile.password.hint")}</div>}
              >
                <div class="hint" id="profile-next-error" style="color:var(--red)" role="alert">
                  {nextPasswordField.error}
                </div>
              </Show>
            </div>

            <div class="field">
              <label for="profile-repeat">{t("profile.password.repeat")}</label>
              <input
                id="profile-repeat"
                class={`input ${repeatPasswordField.error ? "is-invalid" : ""}`}
                type="password"
                autocomplete="new-password"
                maxlength={MAX_PASSWORD_LENGTH}
                placeholder={t("profile.password.repeatPlaceholder")}
                value={repeatPasswordField.value}
                onInput={repeatPasswordField.onInput}
                onBlur={repeatPasswordField.onBlur}
                aria-invalid={repeatPasswordField.error ? "true" : undefined}
                aria-describedby={repeatPasswordField.error ? "profile-repeat-error" : undefined}
              />
              <Show when={repeatPasswordField.error}>
                <div class="hint" id="profile-repeat-error" style="color:var(--red)" role="alert">
                  {repeatPasswordField.error}
                </div>
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
            <Show
              when={this.vm.totpSetup === null}
              fallback={
                <button class="btn btn--primary" type="button" onClick={() => this.vm.submitTotpEnable()} disabled={!this.vm.canEnableTotp}>
                  <Show when={this.vm.totpSaving} fallback={<span>{t("profile.totp.modal.confirm")}</span>}>
                    <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                    <span>{t("common.saving")}</span>
                  </Show>
                </button>
              }
            >
              <button class="btn btn--primary" type="button" onClick={() => { void this.vm.submitTotpSetup(); }} disabled={!this.vm.canSubmitTotpSetup}>
                <Show when={this.vm.totpSetupLoading} fallback={<span>{t("profile.totp.modal.continue")}</span>}>
                  <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                  <span>{t("common.saving")}</span>
                </Show>
              </button>
            </Show>
          </div>
        }
      >
        <div class="stack">
          <Show when={this.vm.totpSetupError}>
            <div class="alert alert--error" role="alert">{this.vm.totpSetupError}</div>
          </Show>
          <Show when={this.vm.totpSetup === null && !this.vm.totpSetupLoading}>
            <form
              class="stack"
              onSubmit={(event: SubmitEvent) => {
                event.preventDefault();
                void this.vm.submitTotpSetup();
              }}
            >
              <div class="field">
                <label for="totp-setup-password">{t("profile.totp.modal.password")}</label>
                <input
                  id="totp-setup-password"
                  class={`input ${totpSetupPasswordField.error ? "is-invalid" : ""}`}
                  type="password"
                  autocomplete="current-password"
                  placeholder="••••••••"
                  value={totpSetupPasswordField.value}
                  onInput={totpSetupPasswordField.onInput}
                  onBlur={totpSetupPasswordField.onBlur}
                  aria-invalid={totpSetupPasswordField.error ? "true" : undefined}
                  aria-describedby={totpSetupPasswordField.error ? "totp-setup-password-error" : "totp-setup-password-hint"}
                  data-autofocus
                />
                <Show
                  when={totpSetupPasswordField.error}
                  fallback={<div class="hint" id="totp-setup-password-hint">{t("profile.totp.modal.passwordHint")}</div>}
                >
                  <div class="hint" id="totp-setup-password-error" style="color:var(--red)" role="alert">
                    {totpSetupPasswordField.error}
                  </div>
                </Show>
              </div>
            </form>
          </Show>
          <Show when={this.vm.totpSetupLoading}>
            <div class="stack" style="align-items:center;gap:10px;padding:16px 0">
              <div class="spinner"></div>
              <div class="small muted">{t("profile.totp.loading")}</div>
            </div>
          </Show>
          <Show when={this.vm.totpSetup}>
            <div class="stack" style="align-items:center;gap:10px">
              <QrCode
                value={this.vm.totpSetup?.otpauth_url ?? ""}
                size={200}
                label={t("profile.totp.modal.qrAria")}
                loadingLabel={t("profile.totp.modal.qrLoading")}
                errorLabel={t("profile.totp.modal.qrError")}
                limitLabel={t("profile.totp.modal.qrLimit")}
              />
              <div class="hint" style="text-align:center">{t("profile.totp.modal.qrHint")}</div>
            </div>
            <div class="field">
              <div class="row-between wrap">
                <label>{t("profile.totp.modal.secret")}</label>
                <button class="btn btn--sm" type="button" onClick={() => { void this.vm.copyTotpSecret(); }}>
                  <Icon name="copy" size={14} class="" /> {t("profile.totp.modal.copySecret")}
                </button>
              </div>
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
              <div class="hint">{t("profile.totp.modal.uriHint")}</div>
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
                class={`input ${totpCodeField.error ? "is-invalid" : ""}`}
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder={t("profile.totp.modal.codePlaceholder")}
                value={totpCodeField.value}
                onInput={totpCodeField.onInput}
                onBlur={totpCodeField.onBlur}
                aria-invalid={totpCodeField.error ? "true" : undefined}
                aria-describedby={totpCodeField.error ? "totp-enable-code-error" : undefined}
              />
              <Show when={totpCodeField.error}>
                <div class="hint" id="totp-enable-code-error" style="color:var(--red)" role="alert">
                  {totpCodeField.error}
                </div>
              </Show>
            </div>
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
              class={`input ${totpDisablePasswordField.error ? "is-invalid" : ""}`}
              type="password"
              autocomplete="current-password"
              value={totpDisablePasswordField.value}
              onInput={totpDisablePasswordField.onInput}
              onBlur={totpDisablePasswordField.onBlur}
              aria-invalid={totpDisablePasswordField.error ? "true" : undefined}
              aria-describedby={totpDisablePasswordField.error ? "totp-disable-password-error" : undefined}
            />
            <Show when={totpDisablePasswordField.error}>
              <div class="hint" id="totp-disable-password-error" style="color:var(--red)" role="alert">
                {totpDisablePasswordField.error}
              </div>
            </Show>
          </div>
          <div class="field">
            <label for="totp-disable-code">{t("profile.totp.modal.code")}</label>
            <input
              id="totp-disable-code"
              class={`input ${totpDisableCodeField.error ? "is-invalid" : ""}`}
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder={t("profile.totp.modal.codePlaceholder")}
              value={totpDisableCodeField.value}
              onInput={totpDisableCodeField.onInput}
              onBlur={totpDisableCodeField.onBlur}
              aria-invalid={totpDisableCodeField.error ? "true" : undefined}
              aria-describedby={totpDisableCodeField.error ? "totp-disable-code-error" : undefined}
            />
            <Show when={totpDisableCodeField.error}>
              <div class="hint" id="totp-disable-code-error" style="color:var(--red)" role="alert">
                {totpDisableCodeField.error}
              </div>
            </Show>
          </div>
        </div>
      </Modal>
    </div>
  );
}