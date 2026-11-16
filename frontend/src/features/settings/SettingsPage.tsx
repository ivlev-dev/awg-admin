import { For, Show } from "@ivlev-dev/silent-core";

import type { SettingsPageVM } from "./SettingsPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";

export function SettingsPage(this: { vm: SettingsPageVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Администрирование</div>
        <div class="row-between wrap">
          <div>
            <h1>Настройки</h1>
            <p>Параметры обфускации AWG 3.1 и срок жизни ссылок на конфиги.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()} disabled={this.vm.loading}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

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
          <div class="empty__title">Настройки недоступны</div>
          <div class="small">Проверьте соединение с сервером и повторите попытку.</div>
          <button class="btn btn--sm" type="button" style="margin-top:var(--sp-3)" onClick={() => this.vm.load()}>
            Повторить
          </button>
        </div>
      </Show>

      <Show when={this.vm.loaded}>
        <form class="stack" onSubmit={(event: SubmitEvent) => this.vm.save(event)}>
          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">Обфускация AWG 3.1</div>
                <div class="card__sub">HTTP/3 mimicry, junk-пакеты и размеры заголовков</div>
              </div>
              <span class="badge badge--violet">AmneziaWG 3.1</span>
            </div>
            <div class="card__body stack">
              <div class="alert alert--info">
                HTTP/3 host mimicry маскирует первые пакеты под QUIC-обмен выбранного браузера. Random trailers добавляет
                случайные завершающие заголовки, высокий Jc усложняет анализ рукопожатия, а размеры пакетов
                выравниваются под браузер. При включённой header protection параметр S должен быть не меньше 12.
              </div>

              <div class="grid grid--2">
                <div class="field">
                  <label for="obf-profile">Профиль маскировки</label>
                  <Select
                    id="obf-profile"
                    value={this.vm.profile}
                    options={this.vm.profileOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setProfile(value)}
                    ariaLabel="Профиль маскировки"
                  />
                  <div class="hint">{this.vm.profileHint}</div>
                </div>

                <div class="field">
                  <label for="obf-intensity">Интенсивность</label>
                  <Select
                    id="obf-intensity"
                    value={this.vm.intensity}
                    options={this.vm.intensityOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setIntensity(value)}
                    ariaLabel="Интенсивность"
                  />
                  <div class="hint">{this.vm.intensityHint}</div>
                </div>

                <div class="field">
                  <label for="obf-browser">Браузер для имитации</label>
                  <Select
                    id="obf-browser"
                    value={this.vm.browser}
                    options={this.vm.browserOptions.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
                    onChange={(value) => this.vm.setBrowser(value)}
                    ariaLabel="Браузер для имитации"
                  />
                  <div class="hint">{this.vm.browserHint}</div>
                </div>

                <div class="field">
                  <label for="obf-mtu">MTU</label>
                  <input
                    id="obf-mtu"
                    class="input"
                    type="number"
                    min="576"
                    max="9000"
                    value={this.vm.mtu}
                    onInput={(event: InputEvent) => this.vm.setNumeric("mtu", event)}
                  />
                  <div class="hint">1280–1500 подходит большинству провайдеров.</div>
                </div>
              </div>

              <hr class="divider" />

              <div class="grid grid--2">
                <div class="field">
                  <label>Jc (junk-пакеты)</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="1"
                      max="128"
                      placeholder="мин"
                      aria-label="Jc минимум"
                      value={this.vm.jcMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jcMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="1"
                      max="128"
                      placeholder="макс"
                      aria-label="Jc максимум"
                      value={this.vm.jcMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jcMax", event)}
                    />
                  </div>
                  <div class="hint">Количество junk-пакетов перед рукопожатием.</div>
                </div>

                <div class="field">
                  <label>Jmin (размер, байт)</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder="мин"
                      aria-label="Jmin минимум"
                      value={this.vm.jminMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jminMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder="макс"
                      aria-label="Jmin максимум"
                      value={this.vm.jminMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jminMax", event)}
                    />
                  </div>
                  <div class="hint">Минимальный размер junk-пакета.</div>
                </div>

                <div class="field">
                  <label>Jmax extra (добавка, байт)</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder="мин"
                      aria-label="Jmax extra минимум"
                      value={this.vm.jmaxExtraMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jmaxExtraMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="0"
                      max="1280"
                      placeholder="макс"
                      aria-label="Jmax extra максимум"
                      value={this.vm.jmaxExtraMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("jmaxExtraMax", event)}
                    />
                  </div>
                  <div class="hint">Случайная добавка к Jmin для максимального размера.</div>
                </div>

                <div class="field">
                  <label>S (header protection)</label>
                  <div class="row" style="gap:8px">
                    <input
                      class="input"
                      type="number"
                      min="12"
                      max="128"
                      placeholder="мин"
                      aria-label="S минимум"
                      value={this.vm.sMin}
                      onInput={(event: InputEvent) => this.vm.setNumeric("sMin", event)}
                    />
                    <span class="muted">—</span>
                    <input
                      class="input"
                      type="number"
                      min="12"
                      max="128"
                      placeholder="макс"
                      aria-label="S максимум"
                      value={this.vm.sMax}
                      onInput={(event: InputEvent) => this.vm.setNumeric("sMax", event)}
                    />
                  </div>
                  <div class="hint">Минимум 12: меньшее значение несовместимо с header protection.</div>
                </div>
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
                    <span class="strong" style="display:block">Random trailers</span>
                    <span class="xs muted">Случайные завершающие заголовки</span>
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
                    <span class="strong" style="display:block">Отключить cookies</span>
                    <span class="xs muted">Не имитировать cookie-заголовки браузера</span>
                  </span>
                </label>
              </div>

              <div class="field">
                <label for="obf-hosts">Хосты для mimicry</label>
                <textarea
                  id="obf-hosts"
                  class="textarea"
                  rows="5"
                  placeholder={"example.com\ngoogle.com"}
                  value={this.vm.hosts}
                  onInput={(event: InputEvent) => this.vm.setHosts(event)}
                ></textarea>
                <div class="hint">
                  По одному хосту в строке. Указано хостов: {this.vm.hostsCount}. Пустой список — использовать значения по
                  умолчанию.
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <div class="card__title">Ссылки на конфиги</div>
                <div class="card__sub">Срок жизни share-ссылок по умолчанию</div>
              </div>
            </div>
            <div class="card__body">
              <div class="field" style="max-width:320px">
                <label for="share-ttl">Время жизни, часы</label>
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
                  В API значение хранится в секундах: {this.vm.ttlSeconds} с. 0 — без ограничения срока.
                </div>
              </div>
            </div>
          </section>

          <div class="actions-bar" style="justify-content:flex-end">
            <button class="btn" type="button" onClick={() => this.vm.load()} disabled={this.vm.saving}>
              Отменить изменения
            </button>
            <button class="btn btn--primary" type="submit" disabled={!this.vm.canSave}>
              <Show when={this.vm.saving} fallback={<span>Сохранить настройки</span>}>
                <span
                  class="spinner"
                  style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"
                ></span>
                <span>Сохраняем…</span>
              </Show>
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
