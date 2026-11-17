import { For, Show } from "@ivlev-dev/silent-core";

import type { OverviewVM } from "./Overview.vm";
import { Sparkline } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

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
          <div class="stat__label">{t("overview.state.nodes")}</div>
          <div class="stat__value">{this.vm.nodesOnline} / {this.vm.nodesTotal}</div>
          <div class="stat__hint">{t("overview.state.nodesHint")}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t("overview.state.interfaces")}</div>
          <div class="stat__value">{this.vm.interfaces}</div>
          <div class="stat__hint">{t("overview.state.interfacesHint")}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t("overview.state.clients")}</div>
          <div class="stat__value">{this.vm.devices}</div>
          <div class="stat__hint">{t("overview.state.clientsHint")}</div>
        </div>
        <div class="stat">
          <div class="stat__label">{t("overview.state.groups")}</div>
          <div class="stat__value">{this.vm.groups}</div>
          <div class="stat__hint">{t("overview.state.groupsHint")}</div>
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
            <div class="stack-sm">
              <div>
                <span class="xs muted">{t("overview.stats.rateRx")}</span>{" "}
                <strong class="mono">{this.vm.rxRate}</strong>
              </div>
              <div>
                <span class="xs muted">{t("overview.stats.rateTx")}</span>{" "}
                <strong class="mono">{this.vm.txRate}</strong>
              </div>
              <div class="xs muted">
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

    </div>
  );
}
