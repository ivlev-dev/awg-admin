import { For, Show } from "@ivlev-dev/silent-core";

import type { SettingsPageVM } from "./SettingsPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function SettingsPage(this: { vm: SettingsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("settings.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("settings.title")}</h1>
            <p>{t("settings.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card card--elevated">
        <div class="card__head">
          <div>
            <div class="card__title">{t("language.title")}</div>
            <div class="card__sub">{t("language.subtitle")}</div>
          </div>
        </div>
        <div class="card__body">
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
      </section>

      <section class="card card--elevated">
        <div class="card__head">
          <div>
            <div class="card__title">{t("settings.interface.title")}</div>
            <div class="card__sub">{t("settings.interface.subtitle")}</div>
          </div>
        </div>
        <div class="card__body">
          <div class="field" style="max-width:320px">
            <label for="ui-density">{t("settings.interface.density")}</label>
            <Select
              id="ui-density"
              value={this.vm.tableDensity}
              options={this.vm.densityOptions.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => this.vm.setTableDensity(value)}
              ariaLabel={t("settings.interface.density")}
            />
            <div class="hint">{t("settings.interface.density.hint")}</div>
          </div>
        </div>
      </section>

      <Show when={this.vm.loading}>
        <div class="stack">
          <div class="skeleton" style="height:280px"></div>
          <div class="skeleton" style="height:140px"></div>
        </div>
      </Show>

      <Show when={!this.vm.loading && !this.vm.loaded}>
        <div class="empty">
          <div class="empty__icon">
            <Icon name="settings" size={40} class="" />
          </div>
          <div class="empty__title">{t("settings.unavailable.title")}</div>
          <div class="small">{t("settings.unavailable.text")}</div>
          <button class="btn btn--sm" type="button" style="margin-top:var(--sp-3)" onClick={() => this.vm.load()}>
            {t("common.retry")}
          </button>
        </div>
      </Show>

      <Show when={this.vm.loaded}>
        <Show when={this.vm.dirty}>
          <div class="alert alert--warn alert--with-action" role="status">
            <span>{t("settings.dirty.text")}</span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.reset()}>
              {t("settings.dirty.reset")}
            </button>
          </div>
        </Show>
        <form class="stack" onSubmit={(event: SubmitEvent) => this.vm.save(event)}>
          <section class="card card--elevated">
            <div class="card__head">
              <div>
                <div class="card__title">{t("settings.obfuscation.title")}</div>
                <div class="card__sub">{t("settings.obfuscation.subtitle")}</div>
              </div>
              <span class="badge badge--violet">{t("settings.obfuscation.badge")}</span>
            </div>
            <div class="card__body stack">
              <div class="alert alert--info">
                {t("settings.obfuscation.info")}
              </div>

              <div class="grid grid--2">
                <div class="field">
                  <label for="obf-profile">{t("settings.field.profile")}</label>
                  <Select
                    id="obf-profile"
                    value={this.vm.profile}
                    options={this.vm.profileOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setProfile(value)}
                    ariaLabel={t("settings.field.profile")}
                  />
                  <div class="hint">{this.vm.profileHint}</div>
                </div>

                <div class="field">
                  <label for="obf-intensity">{t("settings.field.intensity")}</label>
                  <Select
                    id="obf-intensity"
                    value={this.vm.intensity}
                    options={this.vm.intensityOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setIntensity(value)}
                    ariaLabel={t("settings.field.intensity")}
                  />
                  <div class="hint">{this.vm.intensityHint}</div>
                </div>

                <div class="field">
                  <label for="obf-browser">{t("settings.field.browser")}</label>
                  <Select
                    id="obf-browser"
                    value={this.vm.browser}
                    options={this.vm.browserOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setBrowser(value)}
                    ariaLabel={t("settings.field.browser")}
                  />
                  <div class="hint">{this.vm.browserHint}</div>
                </div>

                <div class="field">
                  <label for="obf-mtu">{t("settings.field.mtu")}</label>
                  <input
                    id="obf-mtu"
                    class="input"
                    type="number"
                    min="576"
                    max="9000"
                    value={this.vm.mtu}
                    onInput={(event: InputEvent) => this.vm.setNumeric("mtu", event)}
                  />
                  <div class="hint">{t("settings.field.mtuHint")}</div>
                </div>
              </div>

              <hr class="divider" />

              <div class="grid grid--2">
                <div class="field">
                  <label>{t("settings.field.jc")}</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="1"
                      max="128"
                      placeholder={t("settings.field.min")}
                      aria-label={t("settings.field.jcMinAria")}
                      value={this.vm.jcMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jcMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="1"
                      max="128"
                      placeholder={t("settings.field.max")}
                      aria-label={t("settings.field.jcMaxAria")}
                      value={this.vm.jcMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jcMax", event)}
                    />
                  </div>
                  <div class="hint">{t("settings.field.jcHint")}</div>
                </div>

                <div class="field">
                  <label>{t("settings.field.jmin")}</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder={t("settings.field.min")}
                      aria-label={t("settings.field.jminMinAria")}
                      value={this.vm.jminMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jminMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder={t("settings.field.max")}
                      aria-label={t("settings.field.jminMaxAria")}
                      value={this.vm.jminMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jminMax", event)}
                    />
                  </div>
                  <div class="hint">{t("settings.field.jminHint")}</div>
                </div>

                <div class="field">
                  <label>{t("settings.field.jmaxExtra")}</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder={t("settings.field.min")}
                      aria-label={t("settings.field.jmaxExtraMinAria")}
                      value={this.vm.jmaxExtraMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jmaxExtraMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder={t("settings.field.max")}
                      aria-label={t("settings.field.jmaxExtraMaxAria")}
                      value={this.vm.jmaxExtraMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jmaxExtraMax", event)}
                    />
                  </div>
                  <div class="hint">{t("settings.field.jmaxExtraHint")}</div>
                </div>

                <div class="field">
                  <label>{t("settings.field.s")}</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="12"
                      max="128"
                      placeholder={t("settings.field.min")}
                      aria-label={t("settings.field.sMinAria")}
                      value={this.vm.sMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("sMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="12"
                      max="128"
                      placeholder={t("settings.field.max")}
                      aria-label={t("settings.field.sMaxAria")}
                      value={this.vm.sMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("sMax", event)}
                    />
                  </div>
                  <div class="hint">{t("settings.field.sHint")}</div>
                </div>
              </div>

              <div class="field">
                <label>{t("settings.field.keepalive")}</label>
                <div class="row" style="gap:8px">
                  <input
                    class="input"
                    type="number"
                    min="1"
                    max="120"
                    placeholder={t("settings.field.min")}
                    aria-label={t("settings.field.keepaliveMinAria")}
                    value={this.vm.keepaliveMin}
                    onInput={(event: InputEvent) => this.vm.setNumeric("keepaliveMin", event)}
                  />
                  <span class="muted">—</span>
                  <input
                    class="input"
                    type="number"
                    min="1"
                    max="120"
                    placeholder={t("settings.field.max")}
                    aria-label={t("settings.field.keepaliveMaxAria")}
                    value={this.vm.keepaliveMax}
                    onInput={(event: InputEvent) => this.vm.setNumeric("keepaliveMax", event)}
                  />
                </div>
                <div class="hint">{t("settings.field.keepaliveHint")}</div>
              </div>

              <hr class="divider" />

              <div class="grid grid--2">
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={this.vm.randomTrailers}
                    onChange={(event: Event) => this.vm.setRandomTrailers(event)}
                  />
                  <span class="track"></span>
                  <span class="grow">
                    <span class="strong" style="display:block">{t("settings.field.randomTrailers")}</span>
                    <span class="xs muted">{t("settings.field.randomTrailersHint")}</span>
                  </span>
                </label>

                <label class="switch">
                  <input
                    type="checkbox"
                    checked={this.vm.disableCookies}
                    onChange={(event: Event) => this.vm.setDisableCookies(event)}
                  />
                  <span class="track"></span>
                  <span class="grow">
                    <span class="strong" style="display:block">{t("settings.field.disableCookies")}</span>
                    <span class="xs muted">{t("settings.field.disableCookiesHint")}</span>
                  </span>
                </label>
              </div>

              <div class="field">
                <label for="obf-hosts">{t("settings.field.hosts")}</label>
                <textarea
                  id="obf-hosts"
                  class="textarea"
                  rows="5"
                  placeholder={"example.com\ngoogle.com"}
                  value={this.vm.hosts}
                  onInput={(event: InputEvent) => this.vm.setHosts(event)}
                ></textarea>
                <div class="hint">
                  {t("settings.field.hostsHint", { count: this.vm.hostsCount })}
                </div>
              </div>
            </div>
          </section>

          <section class="card card--elevated">
            <div class="card__head">
              <div>
                <div class="card__title">{t("settings.links.title")}</div>
                <div class="card__sub">{t("settings.links.subtitle")}</div>
              </div>
            </div>
            <div class="card__body">
              <div class="field" style="max-width:320px">
                <label for="share-ttl">{t("settings.links.ttl")}</label>
                <input
                  id="share-ttl"
                  class="input"
                  type="number"
                  min="0"
                  max="8760"
                  step="0.5"
                  value={this.vm.ttlHours}
                  onInput={(event: InputEvent) => this.vm.setTtlHours(event)}
                />
                <div class="hint">
                  {t("settings.links.ttlHint", { seconds: this.vm.ttlSeconds })}
                </div>
              </div>
            </div>
            <div class="card__foot actions-bar settings-actions" style="justify-content:flex-end">
              <button class="btn" type="button" onClick={() => this.vm.reset()} disabled={this.vm.saving}>
                {t("common.cancel")}
              </button>
              <button class="btn btn--primary" type="submit" disabled={!this.vm.canSave}>
                <Show when={this.vm.saving} fallback={<span>{t("settings.action.save")}</span>}>
                  <span
                    class="spinner"
                    style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"
                  ></span>
                  <span>{t("common.saving")}</span>
                </Show>
              </button>
            </div>
          </section>
        </form>
      </Show>
    </div>
  );
}