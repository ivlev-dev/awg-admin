import { Show } from "@ivlev-dev/silent-core";

import type { OverviewVM } from "./Overview.vm";
import { AreaChart, Sparkline } from "@/components/Charts";
import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

const DONUT_RADIUS = 15.9155;

export function Overview(this: { vm: OverviewVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("overview.eyebrow")}</div>
        <h1>{t("overview.title")}</h1>
        <p>{t("overview.subtitle")}</p>
      </div>

      <section class="card card--filled">
        <div class="card__body row-between wrap">
          <div class="actions-bar">
            <span class={`status-chip ${this.vm.live ? "status-chip--ok" : "status-chip--neutral"}`}>
              <span class="status-chip__dot"></span>
              {this.vm.live ? t("overview.live") : t("overview.offline")}
            </span>
            <span class="small muted">
              {t("overview.stats.rxToday")}{" "}
              <strong class="mono">{this.vm.todayRx}</strong>
            </span>
            <span class="small muted">
              {t("overview.stats.txToday")}{" "}
              <strong class="mono">{this.vm.todayTx}</strong>
            </span>
            <span class="small muted">
              {t("overview.stats.month", { value: this.vm.monthTotal })}
            </span>
          </div>
          <button
            class="btn btn--tonal btn--sm"
            type="button"
            onClick={() => this.vm.load()}
            disabled={this.vm.loading}
          >
            <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
          </button>
        </div>
      </section>

      <Show when={this.vm.error}>
        <ErrorState message={this.vm.error ?? ""} onRetry={() => this.vm.load()} />
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

      <div class={`grid ${this.vm.groupsEnabled ? "grid--4" : "grid--3"}`}>
        <div class="stat">
          <div class="stat__top">
            <div class="stat__icon">
              <Icon name="nodes" size={20} class="" />
            </div>
            <span
              class={`status-chip ${
                this.vm.nodesTotal === 0
                  ? "status-chip--neutral"
                  : this.vm.nodesOnline === this.vm.nodesTotal
                    ? "status-chip--ok"
                    : "status-chip--warn"
              }`}
            >
              <span class="status-chip__dot"></span>
              {this.vm.nodesOnline === this.vm.nodesTotal ? t("common.online") : t("overview.offline")}
            </span>
          </div>
          <div>
            <div class="stat__label">{t("overview.state.nodes")}</div>
            <div class="stat__value">
              {this.vm.nodesOnline}
              <span class="muted" style="font-size:22px;font-weight:600"> / {this.vm.nodesTotal}</span>
            </div>
          </div>
          <div class="row-between wrap">
            <span class="stat__hint">{t("overview.state.nodesHint")}</span>
            <Show when={this.vm.nodesTotal > 0}>
              <span
                class={`stat__delta ${
                  this.vm.nodesOnline === this.vm.nodesTotal ? "stat__delta--up" : "stat__delta--down"
                }`}
              >
                {this.vm.nodesShare}%
              </span>
            </Show>
          </div>
          <Show when={this.vm.nodesTotal > 0}>
            <div class="progress">
              <div class="progress__bar" style={`width:${this.vm.nodesShare}%`}></div>
            </div>
          </Show>
        </div>

        <div class="stat">
          <div class="stat__top">
            <div class="stat__icon">
              <Icon name="interfaces" size={20} class="" />
            </div>
          </div>
          <div>
            <div class="stat__label">{t("overview.state.interfaces")}</div>
            <div class="stat__value">{this.vm.interfaces}</div>
          </div>
          <div class="stat__hint">{t("overview.state.interfacesHint")}</div>
        </div>

        <div class="stat">
          <div class="stat__top">
            <div class="stat__icon">
              <Icon name="clients" size={20} class="" />
            </div>
          </div>
          <div>
            <div class="stat__label">{t("overview.state.clients")}</div>
            <div class="row-between">
              <div class="stat__value">{this.vm.devices}</div>
              <Show when={this.vm.spark.length > 1}>
                <Sparkline values={this.vm.spark} width={72} height={24} />
              </Show>
            </div>
          </div>
          <div class="stat__hint">{t("overview.state.clientsHint")}</div>
        </div>

        <Show when={this.vm.groupsEnabled}>
          <div class="stat">
            <div class="stat__top">
              <div class="stat__icon">
                <Icon name="groups" size={20} class="" />
              </div>
            </div>
            <div>
              <div class="stat__label">{t("overview.state.groups")}</div>
              <div class="stat__value">{this.vm.groups}</div>
            </div>
            <div class="stat__hint">{t("overview.state.groupsHint")}</div>
          </div>
        </Show>
      </div>

      <div class="grid grid--2" style="align-items:start">
        <section class="card card--filled" style="display:flex;flex-direction:column">
          <div class="card__head wrap">
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
                    : "status-chip--info"
              }`}
            >
              <span class="status-chip__dot"></span>
              {this.vm.quotaStatusLabel}
            </span>
          </div>
          <div class="card__body stack-sm" style="flex:1">
            <Show
              when={this.vm.quota}
              fallback={
                <div class="small muted">
                  {this.vm.quotaError ?? t("quota.unavailable")}
                </div>
              }
            >
              <div class="row wrap" style="gap:20px;align-items:center">
                <div class="donut">
                  <svg viewBox="0 0 42 42" width="104" height="104" aria-hidden="true">
                    <circle
                      cx="21"
                      cy="21"
                      r={DONUT_RADIUS}
                      fill="none"
                      stroke="var(--md-outline-variant)"
                      stroke-width="5"
                    />
                    <Show when={this.vm.quotaView.hasQuota}>
                      <circle
                        cx="21"
                        cy="21"
                        r={DONUT_RADIUS}
                        fill="none"
                        stroke={
                          this.vm.quotaView.exceeded
                            ? "var(--md-error)"
                            : this.vm.quotaView.progress >= 80
                              ? "var(--md-warning)"
                              : "var(--md-primary)"
                        }
                        stroke-width="5"
                        stroke-linecap="round"
                        stroke-dasharray={`${this.vm.quotaView.progress} ${100 - this.vm.quotaView.progress}`}
                      />
                    </Show>
                  </svg>
                  <div class="donut__center">
                    <strong>{this.vm.quotaView.percentLabel}</strong>
                  </div>
                </div>
                <div class="grow" style="min-width:150px">
                  <div class="quota__value">
                    {this.vm.quotaUsedLabel}{" "}
                    <span class="muted">{t("quota.of", { limit: this.vm.quotaLimitLabel })}</span>
                  </div>
                </div>
              </div>
              <Show when={this.vm.quotaView.hasQuota}>
                <div class="progress">
                  <div
                    class={this.vm.quotaView.progressClass}
                    style={`width:${this.vm.quotaView.progress}%`}
                  ></div>
                </div>
              </Show>
              <div class="grid grid--2" style="gap:8px 12px">
                <div>
                  <div class="xs muted">{t("overview.stats.rxToday")}</div>
                  <div class="mono small">{this.vm.todayRx}</div>
                </div>
                <div>
                  <div class="xs muted">{t("overview.stats.txToday")}</div>
                  <div class="mono small">{this.vm.todayTx}</div>
                </div>
              </div>
              <div class="row-between wrap xs muted">
                <span>{t("quota.remaining", { value: this.vm.quotaRemainingLabel })}</span>
                <span>{t("quota.reset", { date: this.vm.quotaResetLabel })}</span>
              </div>
              <Show when={this.vm.quotaView.exceeded}>
                <div class="alert alert--error">{t("quota.exceededNotice")}</div>
              </Show>
            </Show>
          </div>
          <div class="card__foot actions-bar" style="justify-content:flex-end">
            <button class="btn btn--tonal btn--sm" type="button" onClick={() => this.vm.openStats()}>
              <Icon name="stats" size={16} class="" /> {t("overview.action.stats")}
            </button>
          </div>
        </section>

        <section class="card card--elevated" style="display:flex;flex-direction:column">
          <div class="card__head">
            <div>
              <div class="card__title">{t("overview.activity.title")}</div>
              <div class="card__sub">{t("overview.activity.subtitle")}</div>
            </div>
            <span class="status-chip status-chip--neutral">
              {t("overview.activity.slices", { count: this.vm.spark.length })}
            </span>
          </div>
          <div class="card__body stack-sm" style="flex:1">
            <div class="grid grid--2">
              <div class="resource">
                <div class="resource__top">
                  <span>{t("overview.stats.rateRx")}</span>
                  <Icon name="arrowDown" size={14} class="" />
                </div>
                <div class="resource__value mono">{this.vm.rxRate}</div>
              </div>
              <div class="resource">
                <div class="resource__top">
                  <span>{t("overview.stats.rateTx")}</span>
                  <Icon name="arrowUp" size={14} class="" />
                </div>
                <div class="resource__value mono">{this.vm.txRate}</div>
              </div>
            </div>
            <Show
              when={this.vm.series.length > 1}
              fallback={<div class="xs muted">{t("overview.traffic.emptyText")}</div>}
            >
              <AreaChart data={this.vm.series} height={160} />
            </Show>
            <div class="row-between wrap xs muted">
              <span>{t("overview.stats.rateHint")}</span>
              <span>
                {t("overview.stats.todayTotal")}:{" "}
                <strong class="mono">{this.vm.todayTotal}</strong>
              </span>
            </div>
          </div>
          <div class="card__foot actions-bar">
            <button class="btn btn--tonal btn--sm" type="button" onClick={() => this.vm.openClients()}>
              <Icon name="clients" size={16} class="" /> {t("overview.action.clients")}
            </button>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.openInterfaces()}>
              <Icon name="interfaces" size={16} class="" /> {t("overview.action.interfaces")}
            </button>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.openNodes()}>
              <Icon name="nodes" size={16} class="" /> {t("overview.attention.open")}
            </button>
            <button class="btn btn--ghost btn--sm" type="button" onClick={() => this.vm.openStats()}>
              <Icon name="stats" size={16} class="" /> {t("overview.action.stats")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
