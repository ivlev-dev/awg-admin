import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import { formatDateTimeI18n } from "@/i18n/format";

export function ClientOverviewSection(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <section class="card client-section" id="client-overview" tabindex={-1}>
      <div class="card__head">
        <div>
          <h2 class="card__title" tabindex={-1}>{t("clients.details.title")}</h2>
          <div class="card__sub">{t("clients.details.created", { date: formatDateTimeI18n(vm.device?.created_at ?? null) })}</div>
        </div>
        <span class={`badge ${vm.revoked ? "badge--red" : "badge--green"}`}>
          <span class={`dot ${vm.revoked ? "dot--red" : "dot--green"}`}></span>
          {vm.revoked ? t("clients.status.revoked") : t("clients.status.active")}
        </span>
      </div>
      <div class="card__body stack">
        <Show when={vm.quotaExceeded}>
          <div class="alert alert--error">
            {t("clients.details.quotaExceeded")}
          </div>
        </Show>
        <dl class="kv">
          <dt>{t("clients.details.field.name")}</dt>
          <dd>{vm.device?.name ?? "—"}</dd>
          <dt>{t("clients.details.interface")}</dt>
          <dd>{vm.interfaceLabel}</dd>
          <dt>{t("clients.details.tunnels")}</dt>
          <dd>{vm.tunnelsLabel}</dd>
          <dt>{t("clients.details.node")}</dt>
          <dd>{vm.nodeLabel}</dd>
          <dt>{t("clients.details.field.limitDown")}</dt>
          <dd>{vm.downLabel}</dd>
          <dt>{t("clients.details.field.limitUp")}</dt>
          <dd>{vm.upLabel}</dd>
          <Show when={vm.ownerQuota}>
            <dt>{t("clients.details.field.quota")}</dt>
            <dd>{vm.quotaUsageLabel}</dd>
          </Show>
          <dt>Forwarding</dt>
          <dd>{vm.forwardingLabel}</dd>
        </dl>

        <hr class="divider" />

        <div>
          <div class="xs muted" style="margin-bottom:6px">{t("clients.details.addresses")}</div>
          <Show
            when={vm.addresses.length > 0}
            fallback={<span class="small muted">{t("clients.details.addressesEmpty")}</span>}
          >
            <div class="row wrap" style="gap:6px">
              <For each={vm.addresses}>
                {(address) => <span class="badge badge--blue mono">{address}</span>}
              </For>
            </div>
          </Show>
        </div>

        <hr class="divider" />

        <div>
          <div class="row-between wrap" style="margin-bottom:6px">
            <div class="xs muted">{t("clients.details.tunnels")}</div>
            <button
              class="btn btn--sm btn--ghost"
              type="button"
              disabled={vm.tunnelBusy || vm.tunnelInterfaceOptions.length === 0}
              onClick={() => vm.openAddTunnel()}
            >
              <Icon name="plus" size={14} class="" /> {t("clients.details.tunnels.add")}
            </button>
          </div>
          <Show
            when={vm.tunnels.length > 0}
            fallback={<span class="small muted">{t("clients.details.tunnelsEmpty")}</span>}
          >
            <div class="stack-sm">
              <For each={vm.tunnels}>
                {(tunnel) => (
                  <div class="panel" style="padding:10px 12px">
                    <div class="row-between wrap" style="gap:8px">
                      <div class="stack-sm" style="gap:2px">
                        <span class="small strong">{tunnel.label}</span>
                        <span class="xs muted">
                          {tunnel.interfaceName}
                          <Show when={tunnel.primary}>
                            <span class="badge badge--gray" style="margin-left:6px">
                              {t("clients.details.tunnels.primary")}
                            </span>
                          </Show>
                        </span>
                      </div>
                      <span class="xs mono muted">
                        {tunnel.addresses.length > 0 ? tunnel.addresses.join(", ") : "—"}
                      </span>
                      <Show when={tunnel.endpoint}>
                        <span class="xs mono muted">{tunnel.endpoint}</span>
                      </Show>
                      <Show when={tunnel.publicKey}>
                        <span class="xs mono muted">{tunnel.publicKey.slice(0, 12)}…</span>
                      </Show>
                      <div class="actions-bar">
                        <button
                          class="btn btn--sm btn--ghost"
                          type="button"
                          disabled={vm.tunnelBusy}
                          aria-label={t("clients.details.tunnels.renameAria", { label: tunnel.label })}
                          onClick={() => vm.openRenameTunnel(tunnel)}
                        >
                          <Icon name="edit" size={14} class="" />
                          {t("clients.details.tunnels.rename")}
                        </button>
                        <button
                          class="btn btn--sm btn--danger"
                          type="button"
                          disabled={!vm.canRemoveTunnel}
                          aria-label={t("clients.details.tunnels.deleteAria", { label: tunnel.label })}
                          title={vm.tunnelDeleteHint}
                          onClick={() => { void vm.removeTunnel(tunnel.peerId); }}
                        >
                          <Icon name="trash" size={14} class="" />
                          {t("common.delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <Show when={vm.tunnelDeleteHint}>
              <div class="hint" style="margin-top:6px">{vm.tunnelDeleteHint}</div>
            </Show>
          </Show>
        </div>

        <hr class="divider" />

        <div class="actions-bar">
          <Show when={!vm.revoked}>
            <button
              class="btn btn--sm btn--danger"
              type="button"
              disabled={vm.actionBusy}
              onClick={() => vm.revoke()}
            >
              <Icon name="warning" size={14} class="" /> {t("clients.details.revoke")}
            </button>
          </Show>
          <button
            class="btn btn--sm btn--danger"
            type="button"
            disabled={vm.actionBusy}
            onClick={() => vm.remove()}
          >
            <Icon name="trash" size={14} class="" /> {t("clients.details.delete")}
          </button>
        </div>
      </div>
    </section>
  );
}
