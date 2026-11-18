import { For, Match, Show, Switch } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "./ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { QrCode } from "@/components/QrCode";
import { RateField } from "@/components/RateField";
import { Select } from "@/components/Select";
import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";
import { formatDateTimeI18n } from "@/i18n/format";

export function ClientDetails(this: { vm: ClientDetailsVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("clients.details.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{this.vm.device?.name ?? t("clients.details.title")}</h1>
            <p>{t("clients.details.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm btn--ghost" type="button" onClick={() => this.vm.back()}>
              ← {t("common.back")}
            </button>
            <button class="btn btn--sm" type="button" onClick={() => this.vm.load()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      <Show when={this.vm.device}>
        <div class="client-subnav">
          <div class="client-subnav__meta">
            <span class="client-subnav__name">
              {this.vm.device?.name ?? t("clients.details.title")}
            </span>
            <span class={`badge ${this.vm.revoked ? "badge--red" : "badge--green"}`}>
              <span class={`dot ${this.vm.revoked ? "dot--red" : "dot--green"}`}></span>
              {this.vm.revoked ? t("clients.status.revoked") : t("clients.status.active")}
            </span>
            <span class="client-subnav__address mono">{this.vm.addresses[0] ?? "—"}</span>
            <Show when={this.vm.tunnelCount > 0}>
              <span class="badge badge--blue" title={this.vm.tunnelsLabel}>
                {this.vm.tunnelsCountLabel}
              </span>
            </Show>
          </div>
          <nav class="client-subnav__links" aria-label={t("clients.details.nav.aria")}>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-stats")}
            >
              {t("clients.details.nav.stats")}
            </button>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-overview")}
            >
              {t("clients.details.nav.overview")}
            </button>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-settings")}
            >
              {t("clients.details.nav.settings")}
            </button>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-forwarding")}
            >
              {t("clients.details.nav.forwarding")}
            </button>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-profiles")}
            >
              {t("clients.details.nav.profiles")}
            </button>
            <button
              class="client-subnav__link"
              type="button"
              onClick={() => this.vm.scrollToSection("client-share")}
            >
              {t("clients.details.nav.share")}
            </button>
          </nav>
        </div>
      </Show>

      <Show when={this.vm.error}>
        <div class="alert alert--error">{this.vm.error}</div>
      </Show>

      <Show
        when={!this.vm.loading}
        fallback={
          <div class="stack">
            <Skeleton height={28} width="55%" />
            <SkeletonCards count={4} />
            <div class="grid grid--2">
              <Skeleton height={220} radius={16} />
              <Skeleton height={220} radius={16} />
            </div>
            <section class="card">
              <div class="card__body">
                <SkeletonTable rows={4} columns={4} />
              </div>
            </section>
          </div>
        }
      >
        <div class="stack">
          <div class="grid grid--4 client-section" id="client-stats" tabindex={-1}>
            <div class="stat">
              <div class="stat__label"><span class="dot dot--green"></span>{t("clients.details.stats.rxToday")}</div>
              <div class="stat__value">{this.vm.todayRx}</div>
              <div class="stat__hint">{t("clients.details.stats.monthHint", { value: this.vm.monthRx })}</div>
            </div>
            <div class="stat">
              <div class="stat__label"><span class="dot" style="background:var(--brand-3)"></span>{t("clients.details.stats.txToday")}</div>
              <div class="stat__value">{this.vm.todayTx}</div>
              <div class="stat__hint">{t("clients.details.stats.monthHint", { value: this.vm.monthTx })}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("clients.details.stats.rxMonth")}</div>
              <div class="stat__value">{this.vm.monthRx}</div>
              <div class="stat__hint">{t("clients.details.stats.todayHint", { value: this.vm.todayRx })}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("clients.details.stats.txMonth")}</div>
              <div class="stat__value">{this.vm.monthTx}</div>
              <div class="stat__hint">{t("clients.details.stats.todayHint", { value: this.vm.todayTx })}</div>
            </div>
          </div>

          <Show
            when={this.vm.device}
            fallback={
              <div class="empty">
                <div class="empty__title">{t("clients.details.notFound.title")}</div>
                <div class="small">{t("clients.details.notFound.text")}</div>
                <div style="margin-top:14px">
                  <button class="btn btn--sm" type="button" onClick={() => this.vm.back()}>
                    {t("clients.details.notFound.action")}
                  </button>
                </div>
              </div>
            }
          >
            <div class="stack">
              <div class="grid grid--2">
                <section class="card client-section" id="client-overview" tabindex={-1}>
                  <div class="card__head">
                    <div>
                      <h2 class="card__title" tabindex={-1}>{t("clients.details.title")}</h2>
                      <div class="card__sub">{t("clients.details.created", { date: formatDateTimeI18n(this.vm.device?.created_at ?? null) })}</div>
                    </div>
                    <span class={`badge ${this.vm.revoked ? "badge--red" : "badge--green"}`}>
                      <span class={`dot ${this.vm.revoked ? "dot--red" : "dot--green"}`}></span>
                      {this.vm.revoked ? t("clients.status.revoked") : t("clients.status.active")}
                    </span>
                  </div>
                  <div class="card__body stack">
                    <Show when={this.vm.quotaExceeded}>
                      <div class="alert alert--error">
                        {t("clients.details.quotaExceeded")}
                      </div>
                    </Show>
                    <dl class="kv">
                      <dt>{t("clients.details.field.name")}</dt>
                      <dd>{this.vm.device?.name ?? "—"}</dd>
                      <dt>{t("clients.details.interface")}</dt>
                      <dd>{this.vm.interfaceLabel}</dd>
                      <dt>{t("clients.details.tunnels")}</dt>
                      <dd>{this.vm.tunnelsLabel}</dd>
                      <dt>{t("clients.details.node")}</dt>
                      <dd>{this.vm.nodeLabel}</dd>
                      <dt>{t("clients.details.field.limitDown")}</dt>
                      <dd>{this.vm.downLabel}</dd>
                      <dt>{t("clients.details.field.limitUp")}</dt>
                      <dd>{this.vm.upLabel}</dd>
                      <Show when={this.vm.ownerQuota}>
                        <dt>{t("clients.details.field.quota")}</dt>
                        <dd>{this.vm.quotaUsageLabel}</dd>
                      </Show>
                      <dt>Forwarding</dt>
                      <dd>{this.vm.forwardingLabel}</dd>
                    </dl>

                    <hr class="divider" />

                    <div>
                      <div class="xs muted" style="margin-bottom:6px">{t("clients.details.addresses")}</div>
                      <Show
                        when={this.vm.addresses.length > 0}
                        fallback={<span class="small muted">{t("clients.details.addressesEmpty")}</span>}
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
                      <div class="xs muted" style="margin-bottom:6px">{t("clients.details.tunnels")}</div>
                      <Show
                        when={this.vm.tunnels.length > 0}
                        fallback={<span class="small muted">{t("clients.details.tunnelsEmpty")}</span>}
                      >
                        <div class="stack-sm">
                          <For each={this.vm.tunnels}>
                            {(tunnel) => (
                              <div class="row-between wrap">
                                <span class="small strong">{tunnel.interfaceName}</span>
                                <span class="xs mono muted">
                                  {tunnel.addresses.length > 0 ? tunnel.addresses.join(", ") : "—"}
                                </span>
                                <Show when={tunnel.endpoint}>
                                  <span class="xs mono muted">{tunnel.endpoint}</span>
                                </Show>
                                <Show when={tunnel.publicKey}>
                                  <span class="xs mono muted">{tunnel.publicKey.slice(0, 12)}…</span>
                                </Show>
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
                          <Icon name="warning" size={14} class="" /> {t("clients.details.revoke")}
                        </button>
                      </Show>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        disabled={this.vm.actionBusy}
                        onClick={() => this.vm.remove()}
                      >
                        <Icon name="trash" size={14} class="" /> {t("clients.details.delete")}
                      </button>
                    </div>
                  </div>
                </section>

                <section class="card client-section" id="client-settings" tabindex={-1}>
                  <div class="card__head">
                    <div>
                      <h2 class="card__title" tabindex={-1}>{t("clients.details.edit.title")}</h2>
                      <div class="card__sub">{t("clients.details.edit.subtitle")}</div>
                    </div>
                  </div>
                  <div class="card__body stack">
                    <div class="grid grid--2">
                      <div class="field">
                        <div class="xs muted">{t("clients.details.interface")}</div>
                        <div class="small strong">{this.vm.interfaceLabel}</div>
                      </div>
                      <div class="field">
                        <div class="xs muted">{t("clients.details.node")}</div>
                        <div class="small strong">{this.vm.nodeLabel}</div>
                      </div>
                    </div>
                    <div class="field">
                      <label for="device-name">{t("clients.details.field.name")}</label>
                      <input
                        id="device-name"
                        class="input"
                        type="text"
                        value={this.vm.editName}
                        onInput={(event: Event) => this.vm.setEditName(event)}
                      />
                    </div>

                    <div class="grid grid--2">
                      <RateField
                        id="device-down"
                        label={t("clients.form.down")}
                        value={this.vm.editDownKbps}
                        hint={t("clients.form.limitHint")}
                        onChange={(kbps) => this.vm.setEditDownKbps(kbps)}
                      />
                      <RateField
                        id="device-up"
                        label={t("clients.form.up")}
                        value={this.vm.editUpKbps}
                        hint={t("clients.form.limitHint")}
                        onChange={(kbps) => this.vm.setEditUpKbps(kbps)}
                      />
                    </div>

                    <Show when={this.vm.rateLimitHint}>
                      <div class="alert alert--warn">{this.vm.rateLimitHint}</div>
                    </Show>

                    <Show when={!this.vm.isAdmin}>
                      <div class="alert alert--info">
                        {t("clients.details.edit.tariffNotice")}
                      </div>
                    </Show>

                    <hr class="divider" />

                    <div class="stack-sm">
                      <div class="xs muted">{t("clients.details.forwarding.section")}</div>
                      <div class="stack-sm" role="radiogroup" aria-label={t("clients.details.forwarding.modeAria")}>
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
                          {t("clients.details.forwarding.allNotice")}
                        </div>
                      </Show>

                      <Show when={this.vm.forwardingMode === "selected"}>
                        <div class="stack-sm">
                          <div class="xs muted">{t("clients.details.forwarding.selectedTitle")}</div>
                          <Show
                            when={this.vm.otherDevices.length > 0}
                            fallback={<div class="small muted">{t("clients.details.forwarding.noOthers")}</div>}
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

                    <div class="row" style="gap:8px">
                      <button
                        class="btn btn--primary"
                        type="button"
                        disabled={!this.vm.canSave}
                        onClick={() => this.vm.save()}
                      >
                        <Show when={this.vm.saving} fallback={<span>{t("common.saveShort")}</span>}>
                          <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                          <span>{t("common.saving")}</span>
                        </Show>
                      </button>
                      <button
                        class="btn"
                        type="button"
                        disabled={!this.vm.editDirty || this.vm.saving}
                        onClick={() => void this.vm.cancelEdit()}
                      >
                        {t("common.cancelShort")}
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              <section class="card client-section" id="client-forwarding" tabindex={-1}>
                <div class="card__head">
                  <div>
                    <h2 class="card__title" tabindex={-1}>{t("clients.details.forwarding.matrix.title")}</h2>
                    <div class="card__sub">
                      {t("clients.details.forwarding.matrix.subtitle")}
                    </div>
                  </div>
                  <label class="switch">
                    <input
                      type="checkbox"
                      checked={this.vm.forwardingSymmetric}
                      onChange={(event: Event) => this.vm.setForwardingSymmetric(event)}
                    />
                    <span class="track"></span>
                    <span>{t("clients.details.forwarding.matrix.symmetric")}</span>
                  </label>
                </div>
                <div class="card__body stack">
                  <Show
                    when={this.vm.forwardingMatrixReady}
                    fallback={
                      <div class="small muted">
                        {t("clients.details.forwarding.matrix.needTwo")}
                      </div>
                    }
                  >
                    <Show when={this.vm.forwardingBulk}>
                      <div class="alert alert--info">
                        {t("clients.details.forwarding.matrix.bulk")}
                      </div>
                    </Show>

                    <Show when={this.vm.forwardingBusy}>
                      <div class="row xs muted" style="gap:8px;align-items:center">
                        <span class="spinner" style="width:14px;height:14px"></span>
                        <span>{t("clients.details.forwarding.matrix.saving")}</span>
                      </div>
                    </Show>

                    <div class="table-wrap">
                      <table class="table matrix-table">
                        <thead>
                          <tr>
                            <th>{t("clients.details.forwarding.matrix.source")}</th>
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
                                      aria-label={t("clients.details.forwarding.matrix.rowMode", { name: row.name })}
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
                      <div class="xs muted">{t("clients.details.forwarding.matrix.pairs")}</div>
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

              <section class="card client-section" id="client-profiles" tabindex={-1}>
                <div class="card__head">
                  <div>
                    <h2 class="card__title" tabindex={-1}>{t("clients.details.profiles.title")}</h2>
                    <div class="card__sub">{t("clients.details.profiles.subtitle")}</div>
                  </div>
                </div>
                <div class="card__body">
                  <Show
                    when={this.vm.profiles.length > 0}
                    fallback={
                      <div class="empty">
                        <div class="empty__title">{t("clients.details.profiles.emptyTitle")}</div>
                        <div class="small">{t("clients.details.profiles.emptyText")}</div>
                      </div>
                    }
                  >
                    <div class="stack">
                      <div class="tabs" role="tablist" aria-label={t("clients.details.profiles.title")}>
                        <For each={this.vm.profiles}>
                          {(profile) => (
                            <button
                              class={`tab ${this.vm.activeProfileId === profile.interface_id ? "is-active" : ""}`}
                              type="button"
                              role="tab"
                              aria-selected={this.vm.activeProfileId === profile.interface_id}
                              onClick={() => this.vm.selectProfile(profile.interface_id)}
                            >
                              {profile.interface_name}
                            </button>
                          )}
                        </For>
                      </div>

                      <Switch fallback={<div class="small muted">{t("clients.details.profiles.select")}</div>}>
                        <Match when={this.vm.activeProfile}>
                          <div class="stack-sm">
                            <div class="row-between wrap">
                              <div class="xs muted">
                                Endpoint: <span class="mono">{this.vm.activeProfile?.endpoint ?? "—"}</span>
                              </div>
                              <div class="actions-bar">
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.copyProfile()}>
                                  <Icon name="copy" size={14} class="" /> {t("clients.details.profiles.copy")}
                                </button>
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.downloadProfile()}>
                                  <Icon name="download" size={14} class="" /> {t("clients.details.profiles.download")}
                                </button>
                                <button class="btn btn--sm" type="button" onClick={() => this.vm.copyVpn()}>
                                  <Icon name="link" size={14} class="" /> {t("clients.details.profiles.copyVpn")}
                                </button>
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  disabled={!this.vm.canShowConfQr}
                                  aria-label={t("clients.details.qr.openConf")} title={t("clients.details.qr.openConf")}
                                  onClick={() => this.vm.openConfQr()}
                                >
                                  <Icon name="qr" size={14} class="" /> {t("clients.details.qr.buttonConf")}
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

              <section class="card client-section" id="client-share" tabindex={-1}>
                <div class="card__head">
                  <div>
                    <h2 class="card__title" tabindex={-1}>{t("clients.details.share.title")}</h2>
                    <div class="card__sub">{t("clients.details.share.subtitle")}</div>
                  </div>
                  <button
                    class="btn btn--sm btn--danger"
                    type="button"
                    disabled={!this.vm.hasActiveShares || this.vm.shareBusy}
                    aria-label={t("clients.details.share.revokeAllAria")} title={t("clients.details.share.revokeAllAria")}
                    onClick={() => { void this.vm.revokeAllShares(); }}
                  >
                    <Icon name="trash" size={14} class="" /> {t("clients.details.share.revokeAll")}
                  </button>
                </div>
                <div class="card__body stack">
                  <Show
                    when={this.vm.profiles.length > 0}
                    fallback={<div class="small muted">{t("clients.details.share.noPeers")}</div>}
                  >
                    <div class="grid grid--3">
                      <div class="field">
                        <label for="share-interface">{t("clients.details.share.interface")}</label>
                        <Select
                          id="share-interface"
                          value={this.vm.shareInterfaceId}
                          options={this.vm.profiles.map((profile) => ({ value: profile.interface_id, label: profile.interface_name }))}
                          onChange={(value) => this.vm.setShareInterface(value)}
                          ariaLabel={t("clients.details.share.interface")}
                        />
                      </div>
                      <div class="field">
                        <label for="share-format">{t("clients.details.share.format")}</label>
                        <Select
                          id="share-format"
                          value={this.vm.shareFormat}
                          options={this.vm.formatOptions.map((option) => ({ value: option.value, label: option.label }))}
                          onChange={(value) => this.vm.setShareFormat(value)}
                          ariaLabel={t("clients.details.share.format")}
                        />
                      </div>
                      <div class="field">
                        <label for="share-ttl">{t("clients.details.share.ttl")}</label>
                        <Select
                          id="share-ttl"
                          value={String(this.vm.shareTtl)}
                          options={this.vm.ttlOptions.map((option) => ({ value: String(option.value), label: option.label }))}
                          onChange={(value) => this.vm.setShareTtl(value)}
                          ariaLabel={t("clients.details.share.ttl")}
                        />
                      </div>
                    </div>

                    <div class="grid grid--2">
                      <label class="switch">
                        <input
                          type="checkbox"
                          checked={this.vm.shareOneTime}
                          onChange={(event: Event) => this.vm.setShareOneTime(event)}
                        />
                        <span class="track"></span>
                        <span>
                          {t("clients.details.share.oneTime")}
                          <span class="xs muted" style="margin-left:8px">
                            {t("clients.details.share.oneTimeHint")}
                          </span>
                        </span>
                      </label>
                      <div class="field">
                        <label for="share-max-uses">{t("clients.details.share.maxUses")}</label>
                        <input
                          id="share-max-uses"
                          class="input"
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          value={this.vm.shareMaxUses}
                          disabled={this.vm.shareOneTime}
                          aria-invalid={this.vm.shareMaxUsesInvalid}
                          placeholder={t("clients.details.share.maxUsesHint")}
                          onInput={(event: Event) =>
                            this.vm.setShareMaxUses((event.target as HTMLInputElement).value)
                          }
                        />
                        <div class={this.vm.shareMaxUsesInvalid ? "hint hint--error" : "hint"}>
                          {t("clients.details.share.maxUsesHint")}
                        </div>
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
                            <Icon name="link" size={14} class="" /> {t("clients.details.share.create")}
                          </span>
                        }
                      >
                        <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                        <span>{t("clients.details.share.creating")}</span>
                      </Show>
                    </button>
                  </Show>

                  <hr class="divider" />

                  <Show
                    when={this.vm.shares.length > 0}
                    fallback={<div class="small muted">{t("clients.details.share.none")}</div>}
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
                                  <Icon name="clock" size={12} class="" /> {t("clients.details.share.expires", { date: formatDateTimeI18n(share.expires_at) })}
                                </span>
                              </div>
                              <div class="copy-row">
                                <input class="input" type="text" readonly value={share.url} />
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  aria-label={t("clients.details.qr.openShare")} title={t("clients.details.qr.openShare")}
                                  onClick={() => this.vm.openShareQr(share)}
                                >
                                  <Icon name="qr" size={14} class="" />
                                </button>
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  aria-label={t("clients.details.share.copyAria")} title={t("clients.details.share.copyAria")}
                                  onClick={() => { void this.vm.copyText(share.url, t("clients.details.share.copyLabel")); }}
                                >
                                  <Icon name="copy" size={14} class="" />
                                </button>
                                <button
                                  class="btn btn--sm btn--danger"
                                  type="button"
                                  disabled={this.vm.shareBusy}
                                  aria-label={t("clients.details.share.revokeAria")} title={t("clients.details.share.revokeAria")}
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

      <Modal
        open={this.vm.qrOpen}
        title={this.vm.qrTitle}
        onClose={() => this.vm.closeQr()}
        footer={
          <button class="btn btn--primary" type="button" onClick={() => this.vm.copyQrValue()}>
            <Icon name="copy" size={14} class="" /> {this.vm.qrCopyLabel}
          </button>
        }
      >
        <div class="stack" style="align-items:center;gap:12px">
          <QrCode
            value={this.vm.qrValue}
            size={340}
            label={t("clients.details.qr.aria")}
            loadingLabel={t("clients.details.qr.loading")}
            errorLabel={t("clients.details.qr.error")}
            limitLabel={t("clients.details.qr.limit")}
          />
          <div class="hint" style="text-align:center">{t("clients.details.qr.hint")}</div>
        </div>
      </Modal>
    </div>
  );
}
