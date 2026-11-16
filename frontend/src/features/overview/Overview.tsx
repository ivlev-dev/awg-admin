import { For, Show } from "@ivlev-dev/silent-core";

import type { OverviewVM } from "./Overview.vm";
import { AreaChart, Sparkline } from "@/components/Charts";
import { Icon } from "@/components/Icon";

export function Overview(this: { vm: OverviewVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">Панель управления</div>
        <div class="row-between wrap">
          <div>
            <h1>Обзор</h1>
            <p>Состояние нод, трафик и активность клиентов за последние сутки.</p>
          </div>
          <div class="actions-bar">
            <span class={`badge ${this.vm.live ? "badge--green" : "badge--amber"}`}>
              <span class={`dot ${this.vm.live ? "dot--green" : ""}`}></span>
              {this.vm.live ? "LIVE" : "офлайн"}
            </span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> Обновить
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Квота трафика</div>
            <div class="card__sub">Период: {this.vm.quotaPeriodLabel}</div>
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
            {this.vm.quotaView.statusLabel}
          </span>
        </div>
        <div class="card__body">
          <Show
            when={this.vm.quota}
            fallback={
              <div class="small muted">
                {this.vm.quotaError ?? "Данные о квоте недоступны"}
              </div>
            }
          >
            <div class="quota">
              <div class="row-between wrap">
                <div class="quota__value">
                  {this.vm.quotaView.usedLabel}
                  <span class="muted"> из {this.vm.quotaView.limitLabel}</span>
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
                  Осталось: <span class="strong">{this.vm.quotaView.remainingLabel}</span>
                </span>
                <span>Сброс: {this.vm.quotaResetLabel}</span>
              </div>
            </div>
            <Show when={this.vm.quotaView.exceeded}>
              <div class="alert alert--error" style="margin-top:var(--sp-3)">
                Квота исчерпана, скорость ограничена 1 Кбит/с
              </div>
            </Show>
          </Show>
        </div>
      </section>

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
          <div class="stat__label">Всего за сегодня</div>
          <div class="stat__value">{this.vm.todayTotal}</div>
          <div class="stat__hint">месяц: {this.vm.monthTotal}</div>
        </div>
        <div class="stat">
          <div class="stat__label">Устройства</div>
          <div class="stat__value">{this.vm.devices}</div>
          <div class="stat__hint">{this.vm.nodesOnline} из {this.vm.nodesTotal} нод онлайн</div>
        </div>
      </div>

      <div class="grid grid--main">
        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Трафик за 24 часа</div>
              <div class="card__sub">Принято и передано по всем интерфейсам</div>
            </div>
            <div class="chart__legend no-mobile">
              <span><i style="background:var(--accent)"></i>Входящий</span>
              <span><i style="background:var(--brand-3)"></i>Исходящий</span>
            </div>
          </div>
          <div class="card__body">
            <Show when={!this.vm.loading} fallback={<div class="skeleton" style="height:220px"></div>}>
              <Show
                when={this.vm.series.length > 0}
                fallback={
                  <div class="empty" style="padding:56px 16px">
                    <div class="empty__title">Нет данных за период</div>
                    <div class="small">Трафик появится после подключения клиентов.</div>
                  </div>
                }
              >
                <AreaChart data={this.vm.series} />
              </Show>
            </Show>
          </div>
        </section>

        <section class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Активность</div>
              <div class="card__sub">Живой поток, последние срезы</div>
            </div>
          </div>
          <div class="card__body stack">
            <div class="row-between">
              <div>
                <div class="xs muted">Скорость сейчас</div>
                <div class="strong mono">{this.vm.spark.length} срезов</div>
              </div>
              <Sparkline values={this.vm.spark} width={160} height={44} fill />
            </div>
            <hr class="divider" />
            <div class="stack-sm">
              <button class="btn btn--block" type="button" onClick={() => this.vm.openClients()}>
                <Icon name="clients" size={16} class="" /> Управление клиентами
              </button>
              <button class="btn btn--block" type="button" onClick={() => this.vm.openInterfaces()}>
                <Icon name="interfaces" size={16} class="" /> Интерфейсы и ноды
              </button>
              <button class="btn btn--block" type="button" onClick={() => this.vm.openStats()}>
                <Icon name="stats" size={16} class="" /> Отчёты и графики
              </button>
            </div>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Топ устройств по трафику</div>
            <div class="card__sub">За текущие сутки</div>
          </div>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.openClients()}>Все клиенты</button>
        </div>
        <Show
          when={this.vm.topDevices.length > 0}
          fallback={<div class="empty"><div class="empty__title">Пока нет трафика</div><div class="small">Подключите клиента, и статистика появится здесь.</div></div>}
        >
          <div class="table-wrap">
            <table class="table table--cards">
              <thead>
                <tr><th>Устройство</th><th>Входящий</th><th>Исходящий</th><th>Всего</th><th></th></tr>
              </thead>
              <tbody>
                <For each={this.vm.topDevices}>
                  {(device) => (
                    <tr>
                      <td data-label="Устройство"><span class="strong">{device.name}</span></td>
                      <td data-label="Входящий" class="mono">{formatTotal(device.rx)}</td>
                      <td data-label="Исходящий" class="mono">{formatTotal(device.tx)}</td>
                      <td data-label="Всего" class="mono">{formatTotal(device.rx + device.tx)}</td>
                      <td><button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.openDevice(device.device_id)}>Открыть</button></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
    </div>
  );
}

function formatTotal(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} КБ`;
  return `${value} Б`;
}
