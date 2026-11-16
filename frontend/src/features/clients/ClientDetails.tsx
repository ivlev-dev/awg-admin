import { For, Match, Show, Switch } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "./ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { formatDate } from "@/domain/format";

export function ClientDetails(this: { vm: ClientDetailsVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Клиент</div>
        <div class="row-between wrap">
          <div>
            <h1>{this.vm.device?.name ?? "Устройство"}</h1>
            <p>Профили подключения, лимиты, forwarding и временные ссылки.</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.back()}>
              ← Назад
            </button>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show
        when={!this.vm.loading}
        fallback={
          <div class="stack">
            <div class="skeleton" style="height:110px"></div>
            <div class="skeleton" style="height:280px"></div>
          </div>
        }
      >
        <div class="stack">
          <div class="grid grid--4">
            <div class="stat">
              <div class="stat__label"><span class="dot dot--green"></span>Принято сегодня</div>
              <div class="stat__value">{this.vm.todayRx}</div>
              <div class="stat__hint">за месяц {this.vm.monthRx}</div>
            </div>
            <div class="stat">
              <div class="stat__label"><span class="dot" style="background:var(--brand-3)"></span>Передано сегодня</div>
              <div class="stat__value">{this.vm.todayTx}</div>
              <div class="stat__hint">за месяц {this.vm.monthTx}</div>
            </div>
            <div class="stat">
              <div class="stat__label">Входящий за месяц</div>
              <div class="stat__value">{this.vm.monthRx}</div>
              <div class="stat__hint">сегодня {this.vm.todayRx}</div>
            </div>
            <div class="stat">
              <div class="stat__label">Исходящий за месяц</div>
              <div class="stat__value">{this.vm.monthTx}</div>
              <div class="stat__hint">сегодня {this.vm.todayTx}</div>
            </div>
          </div>

          <Show
            when={this.vm.device}
            fallback={
              <div class="empty">
                <div class="empty__title">Устройство не найдено</div>
                <div class="small">Возможно, оно было удалено или недоступно.</div>
                <div style="margin-top:14px">
                  <button class="btn btn--sm" type="button" onClick={() => this.vm.back()}>
                    К списку клиентов
                  </button>
                </div>
              </div>
            }
          >
            <div class="stack">
              <div class="grid grid--2">
                <section class="card">
                  <div class="card__head">
                    <div>
                      <div class="card__title">Устройство</div>
                      <div class="card__sub">Создано {formatDate(this.vm.device?.created_at ?? null)}</div>
                    </div>
                    <span class={`badge ${this.vm.revoked ? "badge--red" : "badge--green"}`}>
                      <span class={`dot ${this.vm.revoked ? "dot--red" : "dot--green"}`}></span>
                      {this.vm.revoked ? "Отозвано" : "Активно"}
                    </span>
                  </div>
                  <div class="card__body stack">
                    <dl class="kv">
                      <dt>Имя</dt>
                      <dd>{this.vm.device?.name ?? "—"}</dd>
                      <dt>Группа</dt>
                      <dd>{this.vm.groupLabel}</dd>
                      <dt>Лимит ↓</dt>
                      <dd>{this.vm.downLabel}</dd>
                      <dt>Лимит ↑</dt>
                      <dd>{this.vm.upLabel}</dd>
                      <dt>Forwarding</dt>
                      <dd>{this.vm.forwardingLabel}</dd>
                    </dl>

                    <hr class="divider" />

                    <div>
                      <div class="xs muted" style="margin-bottom:6px">Адреса</div>
                      <Show
                        when={this.vm.addresses.length > 0}
                        fallback={<span class="small muted">Адреса ещё не выданы</span>}
                      >
                        <div class="row wrap" style="gap:6px">
                          <For each={this.vm.addresses}>
                            {(address) => <span class="badge badge--blue mono">{address}</span>}
                          </For>
                        </div>
                      </Show>
                    </div>

                    <hr class="divider" />

                    <div>
                      <div class="xs muted" style="margin-bottom:6px">Интерфейсы и пиры</div>
                      <Show
                        when={this.vm.peers.length > 0}
                        fallback={<span class="small muted">Пиры ещё не созданы</span>}
                      >
                        <div class="stack-sm">
                          <For each={this.vm.peers}>
                            {(peer) => (
                              <div class="row-between">
                                <span class="small strong">{peer.interface_name}</span>
                                <span class="xs mono muted">{peer.public_key.slice(0, 12)}…</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    <hr class="divider" />

                    <div class="actions-bar">
                      <Show when={!this.vm.revoked}>
                        <button
                          class="btn btn--sm btn--danger"
                          type="button"
                          disabled={this.vm.actionBusy}
                          onClick={() => this.vm.revoke()}
                        >
                          <Icon name="warning" size={14} class="" /> Отозвать
                        </button>
                      </Show>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        disabled={this.vm.actionBusy}
                        onClick={() => this.vm.remove()}
                      >
                        <Icon name="trash" size={14} class="" /> Удалить
                      </button>
                    </div>
                  </div>
                </section>

                <section class="card">
                  <div class="card__head">
                    <div>
                      <div class="card__title">Лимиты и forwarding</div>
                      <div class="card__sub">Имя, скорость и доступ между устройствами</div>
                    </div>
                  </div>
                  <div class="card__body stack">
                    <div class="field">
                      <label for="device-name">Имя</label>
                      <input
                        id="device-name"
                        class="input"
                        type="text"
                        value={this.vm.editName}
                        onInput={(event: Event) => this.vm.setEditName(event)}
                      />
                    </div>

                    <div class="grid grid--2">
                      <div class="field">
                        <label for="device-down">Скачивание, Кбит/с</label>
                        <input
                          id="device-down"
                          class="input"
                          type="number"
                          min="0"
                          value={this.vm.editDown}
                          onInput={(event: Event) => this.vm.setEditDown(event)}
                        />
                        <div class="hint">0 — без лимита</div>
                      </div>
                      <div class="field">
                        <label for="device-up">Отдача, Кбит/с</label>
                        <input
                          id="device-up"
                          class="input"
                          type="number"
                          min="0"
                          value={this.vm.editUp}
                          onInput={(event: Event) => this.vm.setEditUp(event)}
                        />
                        <div class="hint">0 — без лимита</div>
                      </div>
                    </div>

                    <Show when={!this.vm.isAdmin}>
                      <div class="alert alert--info">
                        Лимиты не могут превышать ограничения вашего тарифа.
                      </div>
                    </Show>

                    <hr class="divider" />

                    <div class="stack-sm">
                      <div class="xs muted">Forwarding с этого устройства</div>
                      <div class="stack-sm" role="radiogroup" aria-label="Режим forwarding">
                        <For each={this.vm.forwardingModeOptions}>
                          {(option) => (
                            <label class="radio">
                              <input
                                type="radio"
                                name="forwarding-mode"
                                value={option.value}
                                checked={this.vm.forwardingMode === option.value}
                                onChange={() => this.vm.setForwardingMode(option.value)}
                              />
                              <span>
                                {option.label}
                                <Show when={option.hint}>
                                  <span class="xs muted" style="margin-left:8px">{option.hint}</span>
                                </Show>
                              </span>
                            </label>
                          )}
                        </For>
                      </div>

                      <Show when={this.vm.forwardingMode === "all"}>
                        <div class="alert alert--info">
                          Разрешает трафик на все ваши устройства — сразу все пары.
                        </div>
                      </Show>

                      <Show when={this.vm.forwardingMode === "selected"}>
                        <div class="stack-sm">
                          <div class="xs muted">С этого устройства → на выбранные</div>
                          <Show
                            when={this.vm.otherDevices.length > 0}
                            fallback={<div class="small muted">Других активных устройств у пользователя нет.</div>}
                          >
                            <For each={this.vm.otherDevices}>
                              {(device) => (
                                <label class="checkbox">
                                  <input
                                    type="checkbox"
                                    checked={this.vm.isForwardingSelected(device.id)}
                                    onChange={() => this.vm.toggleForwardingSelected(device.id)}
                                  />
                                  <span>
                                    {device.name}
                                    <span class="xs mono muted" style="margin-left:8px">
                                      {device.addresses.join(", ")}
                                    </span>
                                  </span>
                                </label>
                              )}
                            </For>
                          </Show>
                          <Show when={this.vm.forwardingError}>
                            <div class="alert alert--error">{this.vm.forwardingError}</div>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    <button
                      class="btn btn--primary"
                      type="button"
                      disabled={!this.vm.canSave}
                      onClick={() => this.vm.save()}
                    >
                      <Show when={this.vm.saving} fallback={<span>Сохранить</span>}>
                        <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                        <span>Сохраняем…</span>
                      </Show>
                    </button>
                  </div>
                </section>
              </div>

              <section class="card">
                <div class="card__head">
                  <div>
                    <div class="card__title">Матрица forwarding</div>
                    <div class="card__sub">
                      Строка разрешает трафик на столбец. Каждая пара настраивается независимо.
                    </div>
                  </div>
                  <label class="switch">
                    <input
                      type="checkbox"
                      checked={this.vm.forwardingSymmetric}
                      onChange={(event: Event) => this.vm.setForwardingSymmetric(event)}
                    />
                    <span class="track"></span>
                    <span>Симметрично</span>
                  </label>
                </div>
                <div class="card__body stack">
                  <Show
                    when={this.vm.forwardingMatrixReady}
                    fallback={
                      <div class="small muted">
                        Нужно минимум два активных устройства у пользователя.
                      </div>
                    }
                  >
                    <Show when={this.vm.forwardingBulk}>
                      <div class="alert alert--info">
                        Строки в режиме «Все мои устройства» разрешают все пары сразу — точечные
                        отметки для них недоступны.
                      </div>
                    </Show>

                    <Show when={this.vm.forwardingBusy}>
                      <div class="row xs muted" style="gap:8px;align-items:center">
                        <span class="spinner" style="width:14px;height:14px"></span>
                        <span>Сохраняем forwarding…</span>
                      </div>
                    </Show>

                    <div class="table-wrap">
                      <table class="table matrix-table">
                        <thead>
                          <tr>
                            <th>Источник</th>
                            <For each={this.vm.forwardingRows}>
                              {(column) => (
                                <th title={column.addresses.join(", ")}>{column.name}</th>
                              )}
                            </For>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={this.vm.forwardingRows}>
                            {(row) => (
                              <tr>
                                <td>
                                  <div class="stack-sm">
                                    <span class="small strong">{row.name}</span>
                                    <select
                                      class="select matrix-mode"
                                      aria-label={`Режим forwarding для ${row.name}`}
                                      onChange={(event: Event) => {
                                        void this.vm.setForwardingRowMode(
                                          row.id,
                                          (event.target as HTMLSelectElement).value,
                                        );
                                      }}
                                    >
                                      <For each={this.vm.forwardingModeOptions}>
                                        {(option) => (
                                          <option value={option.value} selected={option.value === row.mode}>
                                            {option.label}
                                          </option>
                                        )}
                                      </For>
                                    </select>
                                    <span class="xs mono muted">{row.addresses.join(", ")}</span>
                                  </div>
                                </td>
                                <For each={this.vm.forwardingRows}>
                                  {(column) => (
                                    <td class="matrix-cell">
                                      <Show when={row.id !== column.id} fallback={<span class="xs muted">—</span>}>
                                        <input
                                          type="checkbox"
                                          checked={this.vm.isForwardingCellChecked(row.id, column.id)}
                                          disabled={this.vm.isForwardingCellDisabled(row.id, column.id)}
                                          title={this.vm.forwardingPairTitle(row.id, column.id)}
                                          aria-label={this.vm.forwardingPairTitle(row.id, column.id)}
                                          onChange={() => {
                                            void this.vm.toggleForwardingCell(row.id, column.id);
                                          }}
                                        />
                                      </Show>
                                    </td>
                                  )}
                                </For>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>

                    <div class="forwarding-pairs">
                      <div class="xs muted">Пары устройств</div>
                      <For each={this.vm.forwardingPairs}>
                        {(pair) => (
                          <label class="checkbox">
                            <input
                              type="checkbox"
                              checked={pair.allowed}
                              disabled={pair.disabled}
                              onChange={() => {
                                void this.vm.toggleForwardingPair(pair.aId, pair.bId);
                              }}
                            />
                            <span>
                              {pair.label} — {pair.detail}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </section>

              <section class="card">
                <div class="card__head">
                  <div>
                    <div class="card__title">Профили</div>
                    <div class="card__sub">Конфигурация AmneziaWG по интерфейсам</div>
                  </div>
                </div>
                <div class="card__body">
                  <Show
                    when={this.vm.profiles.length > 0}
                    fallback={
                      <div class="empty">
                        <div class="empty__title">Профилей пока нет</div>
                        <div class="small">Пиры создаются вместе с устройством на интерфейсах группы.</div>
                      </div>
                    }
                  >
                    <div class="stack">
                      <div class="tabs">
                        <For each={this.vm.profiles}>
                          {(profile) => (
                            <button
                              class={`tab ${this.vm.activeProfileId === profile.interface_id ? "is-active" : ""}`}
                              type="button"
                              onClick={() => this.vm.selectProfile(profile.interface_id)}
                            >
                              {profile.interface_name}
                            </button>
                          )}
                        </For>
                      </div>

                      <Switch fallback={<div class="small muted">Выберите интерфейс.</div>}>
                        <Match when={this.vm.activeProfile}>
                          <div class="stack-sm">
                            <div class="row-between wrap">
                              <div class="xs muted">
                                Endpoint: <span class="mono">{this.vm.activeProfile?.endpoint ?? "—"}</span>
                              </div>
                              <div class="actions-bar">
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.copyProfile()}>
                                  <Icon name="copy" size={14} class="" /> Копировать
                                </button>
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.downloadProfile()}>
                                  <Icon name="download" size={14} class="" /> Скачать .conf
                                </button>
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.copyVpn()}>
                                  <Icon name="link" size={14} class="" /> Копировать vpn://
                                </button>
                              </div>
                            </div>
                            <pre class="code">{this.vm.activeProfile?.conf ?? ""}</pre>
                          </div>
                        </Match>
                      </Switch>
                    </div>
                  </Show>
                </div>
              </section>

              <section class="card">
                <div class="card__head">
                  <div>
                    <div class="card__title">Временные ссылки</div>
                    <div class="card__sub">Доступ по ссылке с автоматическим истечением</div>
                  </div>
                </div>
                <div class="card__body stack">
                  <Show
                    when={this.vm.profiles.length > 0}
                    fallback={<div class="small muted">Сначала создайте пир на интерфейсе.</div>}
                  >
                    <div class="grid grid--3">
                      <div class="field">
                        <label for="share-interface">Интерфейс</label>
                        <Select
                          id="share-interface"
                          value={this.vm.shareInterfaceId}
                          options={this.vm.profiles.map((profile) => ({ value: profile.interface_id, label: profile.interface_name }))}
                          onChange={(value) => this.vm.setShareInterface(value)}
                          ariaLabel="Интерфейс"
                        />
                      </div>
                      <div class="field">
                        <label for="share-format">Формат</label>
                        <Select
                          id="share-format"
                          value={this.vm.shareFormat}
                          options={this.vm.formatOptions.map((option) => ({ value: option.value, label: option.label }))}
                          onChange={(value) => this.vm.setShareFormat(value)}
                          ariaLabel="Формат"
                        />
                      </div>
                      <div class="field">
                        <label for="share-ttl">Срок действия</label>
                        <Select
                          id="share-ttl"
                          value={String(this.vm.shareTtl)}
                          options={this.vm.ttlOptions.map((option) => ({ value: String(option.value), label: option.label }))}
                          onChange={(value) => this.vm.setShareTtl(value)}
                          ariaLabel="Срок действия"
                        />
                      </div>
                    </div>

                    <button
                      class="btn btn--primary"
                      type="button"
                      disabled={!this.vm.canCreateShare}
                      onClick={() => this.vm.createShare()}
                    >
                      <Show
                        when={this.vm.shareBusy}
                        fallback={
                          <span class="row" style="gap:6px">
                            <Icon name="link" size={14} class="" /> Создать ссылку
                          </span>
                        }
                      >
                        <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                        <span>Создаём…</span>
                      </Show>
                    </button>
                  </Show>

                  <hr class="divider" />

                  <Show
                    when={this.vm.shares.length > 0}
                    fallback={<div class="small muted">Активных ссылок нет.</div>}
                  >
                    <div class="stack-sm">
                      <For each={this.vm.shares}>
                        {(share) => (
                          <div class="panel" style="padding:12px">
                            <div class="stack-sm">
                              <div class="row-between wrap">
                                <div class="row" style="gap:6px">
                                  <span class={`badge ${share.format === "conf" ? "badge--green" : "badge--blue"}`}>
                                    {share.format === "conf" ? "CONF" : "VPN"}
                                  </span>
                                  <span class="xs muted">{this.vm.interfaceName(share.interface_id)}</span>
                                </div>
                                <span class="xs muted row" style="gap:4px">
                                  <Icon name="clock" size={12} class="" /> до {formatDate(share.expires_at)}
                                </span>
                              </div>
                              <div class="copy-row">
                                <input class="input" type="text" readonly value={share.url} />
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  aria-label="Скопировать ссылку"
                                  onClick={() => { void this.vm.copyText(share.url, "Ссылка"); }}
                                >
                                  <Icon name="copy" size={14} class="" />
                                </button>
                                <button
                                  class="btn btn--sm btn--danger"
                                  type="button"
                                  disabled={this.vm.shareBusy}
                                  aria-label="Отозвать ссылку"
                                  onClick={() => { void this.vm.revokeShare(share.token); }}
                                >
                                  <Icon name="trash" size={14} class="" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </section>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
