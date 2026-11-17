import { For, Show } from "@ivlev-dev/silent-core";

import type { OverviewVM } from "./Overview.vm";
import { Sparkline } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import { formatBytesI18n } from "@/i18n/format";

export function Overview(this: { vm: OverviewVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("overview.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{t("overview.title")}</h1>
            <p>{t("overview.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <span class={`badge ${this.vm.live ? "badge--green" : "badge--amber"}`}>
              <span class={`dot ${this.vm.live ? "dot--green" : ""}`}></span>
              {this.vm.live ? t("overview.live") : t("overview.offline")}
            </span>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show when={this.vm.nodesTotal > this.vm.nodesOnline}>
        <div class="alert alert--warn row-between wrap">
          <span>
            {t("overview.attention.nodes", {
              offline: this.vm.nodesTotal - this.vm.nodesOnline,
              total: this.vm.nodesTotal,
            })}
          </span>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.openNodes()}>
            {t("overview.attention.open")}
          </button>
        </div>
      </Show>

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
            when={this.vm.quota}
            fallback={
              <div class="small muted">
                {this.vm.quotaError ?? t("quota.unavailable")}
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
        </div>
      </section>

      <div class="grid grid--4">
        <div class="stat">
          <div class="stat__label"><span class="dot dot--green"></span>{t("overview.stats.rxToday")}</div>
          <div class="stat__value">{this.vm.todayRx}</div>
          <div class="stat__hint">{t("overview.stats.month", { value: this.vm.monthRx })}</div>
        </div>
        <div class="stat">
          <div class="stat__label"><span class="dot" style="background:var(--brand-3)"></span>{t("overview.stats.txToday")}</div>
          <div class="stat__value">{this.vm.todayTx}</div>
          <div class="stat__hint">{t("overview.stats.month", { value: this.vm.monthTx })}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t("overview.stats.todayTotal")}</div>
          <div class="stat__value">{this.vm.todayTotal}</div>
          <div class="stat__hint">{t("overview.stats.monthTotal", { value: this.vm.monthTotal })}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t("overview.stats.devices")}</div>
          <div class="stat__value">{this.vm.devices}</div>
          <div class="stat__hint">{t("overview.stats.nodesOnline", { online: this.vm.nodesOnline, total: this.vm.nodesTotal })}</div>
        </div>
        <div class="stat">
          <div class="stat__label"><span class="dot dot--green"></span>{t("overview.stats.rateRx")}</div>
          <div class="stat__value">{this.vm.rxRate}</div>
          <div class="stat__hint">{t("overview.stats.rateHint")}</div>
        </div>
        <div class="stat">
          <div class="stat__label"><span class="dot" style="background:var(--brand-3)"></span>{t("overview.stats.rateTx")}</div>
          <div class="stat__value">{this.vm.txRate}</div>
          <div class="stat__hint">{t("overview.stats.rateHint")}</div>
        </div>
      </div>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">{t("overview.activity.title")}</div>
            <div class="card__sub">{t("overview.activity.subtitle")}</div>
          </div>
        </div>
        <div class="card__body stack">
          <div class="row-between wrap">
            <div>
              <div class="xs muted">{t("overview.activity.speed")}</div>
              <div class="strong mono">
                {t("overview.activity.slices", { count: this.vm.spark.length })}
              </div>
            </div>
            <Sparkline values={this.vm.spark} width={220} height={56} fill />
          </div>
          <hr class="divider" />
          <div class="actions-row wrap">
            <button class="btn" type="button" onClick={() => this.vm.openClients()}>
              <Icon name="clients" size={16} class="" /> {t("overview.action.clients")}
            </button>
            <button class="btn" type="button" onClick={() => this.vm.openInterfaces()}>
              <Icon name="interfaces" size={16} class="" /> {t("overview.action.interfaces")}
            </button>
            <button class="btn" type="button" onClick={() => this.vm.openStats()}>
              <Icon name="stats" size={16} class="" /> {t("overview.action.stats")}
            </button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div>
            <div class="card__title">{t("overview.top.title")}</div>
            <div class="card__sub">{t("overview.top.subtitle")}</div>
          </div>
          <button class="btn btn--sm" type="button" onClick={() => this.vm.openClients()}>{t("overview.top.all")}</button>
        </div>
        <Show
          when={this.vm.topDevices.length > 0}
          fallback={<div class="empty"><div class="empty__title">{t("overview.top.emptyTitle")}</div><div class="small">{t("overview.top.emptyText")}</div></div>}
        >
          <div class="table-wrap">
            <table class="table table--cards">
              <thead>
                <tr><th>{t("overview.table.device")}</th><th>{t("overview.table.rx")}</th><th>{t("overview.table.tx")}</th><th>{t("overview.table.total")}</th><th></th></tr>
              </thead>
              <tbody>
                <For each={this.vm.topDevices}>
                  {(device) => (
                    <tr>
                      <td data-label={t("overview.table.device")}><span class="strong">{device.name}</span></td>
                      <td data-label={t("overview.table.rx")} class="mono">{formatBytesI18n(device.rx)}</td>
                      <td data-label={t("overview.table.tx")} class="mono">{formatBytesI18n(device.tx)}</td>
                      <td data-label={t("overview.table.total")} class="mono">{formatBytesI18n(device.rx + device.tx)}</td>
                      <td><button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.openDevice(device.device_id)}>{t("common.open")}</button></td>
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
