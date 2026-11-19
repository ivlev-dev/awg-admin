import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { clientTone, peerTone } from "./status";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function PreviewStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  return (
    <div class="stack">
      <Show when={vm.previewError}>
        <div class="alert alert--error">{vm.previewError}</div>
      </Show>

      <Show when={vm.applyError}>
        <div class="alert alert--error">
          <div class="strong">{t("import.apply.fatal")}</div>
          <div>{vm.applyError}</div>
          <div class="small" style="margin-top:4px">{t("import.apply.rollback")}</div>
        </div>
      </Show>

      <Show
        when={vm.preview}
        fallback={
          <section class="card card--elevated">
            <div class="card__head">
              <div>
                <div class="card__title">{t("import.preview.title")}</div>
                <div class="card__sub">{t("import.preview.subtitle")}</div>
              </div>
              <span class="status-chip status-chip--warn">
                <span class="status-chip__dot"></span>
                {t("import.preview.emptyTitle")}
              </span>
            </div>
            <div class="card__body stack">
              <div class="empty">
                <div class="empty__icon">
                  <Icon name="import" size={24} class="" />
                </div>
                <div class="empty__title">{t("import.preview.emptyTitle")}</div>
                <div class="empty__text">{t("import.preview.emptyText")}</div>
              </div>
            </div>
            <div class="card__foot actions-bar">
              <div class="data-toolbar__actions">
                <button class="btn" type="button" onClick={() => vm.back()}>
                  {t("import.preview.back")}
                </button>
                <button
                  class="btn btn--primary"
                  type="button"
                  disabled={!vm.canPreview}
                  onClick={() => vm.previewNow()}
                >
                  <Show
                    when={vm.previewing}
                    fallback={
                      <>
                        <Icon name="check" size={16} class="" />
                        {t("import.preview.action")}
                      </>
                    }
                  >
                    <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                    {t("import.preview.checking")}
                  </Show>
                </button>
              </div>
            </div>
          </section>
        }
      >
        <section class="card card--elevated">
          <div class="card__head">
            <div>
              <div class="card__title">{t("import.preview.title")}</div>
              <div class="card__sub">{t("import.preview.subtitle")}</div>
            </div>
            <span class="status-chip status-chip--info">
              <span class="status-chip__dot"></span>
              {t("import.preview.group", { name: vm.preview?.group.name ?? "" })}
            </span>
          </div>
          <div class="card__body stack">
            <div class="grid grid--4">
              <div class="stat">
                <div class="stat__label">{t("import.preview.summary.create")}</div>
                <div class="stat__value">{vm.previewSummary?.create ?? 0}</div>
              </div>
              <div class="stat">
                <div class="stat__label">{t("import.preview.summary.duplicate")}</div>
                <div class="stat__value">{vm.previewSummary?.duplicate ?? 0}</div>
              </div>
              <div class="stat">
                <div class="stat__label">{t("import.preview.summary.error")}</div>
                <div class="stat__value">{vm.previewSummary?.error ?? 0}</div>
              </div>
              <div class="stat">
                <div class="stat__label">{t("import.preview.summary.interfaces")}</div>
                <div class="stat__value">{vm.previewSummary?.interfaces ?? 0}</div>
              </div>
            </div>

            <Show when={vm.previewHasExternal}>
              <div class="section-title">
                <h2>{t("import.preview.servers.summary")}</h2>
              </div>
              <div class="grid grid--3">
                <div class="stat">
                  <div class="stat__label">{t("import.preview.summary.external.create")}</div>
                  <div class="stat__value">{vm.previewExternalCounts.create}</div>
                </div>
                <div class="stat">
                  <div class="stat__label">{t("import.preview.summary.external.duplicate")}</div>
                  <div class="stat__value">{vm.previewExternalCounts.duplicate}</div>
                </div>
                <div class="stat">
                  <div class="stat__label">{t("import.preview.summary.external.error")}</div>
                  <div class="stat__value">{vm.previewExternalCounts.error}</div>
                </div>
              </div>
            </Show>

            <Show when={vm.previewWarnings.length > 0}>
              <div class="alert alert--warn">
                <div class="strong">{t("import.preview.warnings")}</div>
                <ul style="margin:8px 0 0;padding-left:18px">
                  <For each={vm.previewWarnings}>
                    {(warning) => <li class="small">{warning}</li>}
                  </For>
                </ul>
              </div>
            </Show>
          </div>
          <div class="card__foot actions-bar">
            <div class="data-toolbar__actions">
              <button class="btn" type="button" onClick={() => vm.back()}>
                {t("import.preview.back")}
              </button>
              <button
                class="btn"
                type="button"
                disabled={!vm.canPreview}
                onClick={() => vm.previewNow()}
              >
                {t("import.preview.recheck")}
              </button>
              <button
                class="btn btn--primary"
                type="button"
                disabled={!vm.canApply}
                onClick={() => vm.applyNow()}
              >
                <Show
                  when={vm.applying}
                  fallback={
                    <>
                      <Icon name="import" size={16} class="" />
                      {t("import.preview.apply")}
                    </>
                  }
                >
                  <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
                  {t("import.preview.applying")}
                </Show>
              </button>
            </div>
          </div>
        </section>

        <For each={vm.previewInterfaces}>
          {(iface) => (
            <section class="card card--elevated">
              <div class="card__head">
                <div style="min-width:0">
                  <div class="card__title">
                    {t("import.preview.interface")} #{iface.index + 1} · {iface.name}
                  </div>
                  <div class="card__sub mono truncate">
                    {t("import.preview.publicKey")}: {vm.previewKey(iface)}
                  </div>
                </div>
                <div class="row wrap">
                  <span class="status-chip status-chip--ok">
                    <span class="status-chip__dot"></span>
                    {t("import.preview.summary.create")}: {iface.counts.create}
                  </span>
                  <span class="status-chip status-chip--warn">
                    <span class="status-chip__dot"></span>
                    {t("import.preview.summary.duplicate")}: {iface.counts.duplicate}
                  </span>
                  <span class="status-chip status-chip--error">
                    <span class="status-chip__dot"></span>
                    {t("import.preview.summary.error")}: {iface.counts.error}
                  </span>
                </div>
              </div>
              <div class="card__body stack">
                <div class="table-wrap">
                  <table class="table table--cards table--fixed" aria-label={t("import.preview.title")}>
                    <thead>
                      <tr>
                        <th>{t("import.preview.client")}</th>
                        <th>{t("import.preview.status")}</th>
                        <th>{t("import.preview.address")}</th>
                        <th>{t("import.preview.reason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={iface.clients}>
                        {(client) => (
                          <tr>
                            <td data-label={t("import.preview.client")}>
                              <span class="strong">{client.name}</span>
                            </td>
                            <td data-label={t("import.preview.status")}>
                              <span class={`status-chip status-chip--${clientTone(client.status)}`}>
                                <span class="status-chip__dot"></span>
                                {vm.previewStatusLabel(client.status)}
                              </span>
                            </td>
                            <td data-label={t("import.preview.address")} class="mono small">
                              {vm.previewClientAddress(client)}
                            </td>
                            <td data-label={t("import.preview.reason")} class="small">
                              {vm.previewClientReason(client)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>

                <Show when={iface.server_peers.length > 0}>
                  <div class="stack-sm">
                    <div class="section-title">
                      <h2>{t("import.preview.servers.title")}</h2>
                      <div class="row wrap">
                        <span class="status-chip status-chip--ok">
                          <span class="status-chip__dot"></span>
                          {t("import.preview.status.create")}: {iface.server_peer_counts.create}
                        </span>
                        <span class="status-chip status-chip--warn">
                          <span class="status-chip__dot"></span>
                          {t("import.preview.status.duplicate")}: {iface.server_peer_counts.duplicate}
                        </span>
                        <span class="status-chip status-chip--error">
                          <span class="status-chip__dot"></span>
                          {t("import.preview.status.error")}: {iface.server_peer_counts.error}
                        </span>
                      </div>
                    </div>
                    <div class="small muted">{t("import.preview.servers.subtitle")}</div>
                    <div class="table-wrap">
                      <table class="table table--cards table--fixed" aria-label={t("import.preview.servers.title")}>
                          <thead>
                          <tr>
                            <th>{t("import.preview.publicKey")}</th>
                            <th>{t("import.preview.status")}</th>
                            <th>{t("import.preview.address")}</th>
                            <th>{t("import.preview.reason")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={iface.server_peers}>
                            {(peer) => (
                              <tr>
                                <td data-label={t("import.preview.publicKey")} class="mono small">
                                  <span title={peer.public_key}>{vm.shortKey(peer.public_key)}</span>
                                </td>
                                <td data-label={t("import.preview.status")}>
                                  <span class={`status-chip status-chip--${peerTone(peer.status)}`}>
                                    <span class="status-chip__dot"></span>
                                    {vm.serverPeerStatusLabel(peer.status)}
                                  </span>
                                </td>
                                <td data-label={t("import.preview.address")} class="mono small">
                                  {vm.serverPeerAddress(peer)}
                                </td>
                                <td data-label={t("import.preview.reason")} class="small">
                                  {vm.serverPeerReason(peer)}
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Show>
              </div>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}
