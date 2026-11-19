import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { clientTone } from "./status";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ClientsPreviewStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  return (
    <div class="stack">
      <Show when={vm.clientsPreviewError}>
        <div class="alert alert--error">{vm.clientsPreviewError}</div>
      </Show>

      <Show when={vm.clientsApplyError}>
        <div class="alert alert--error">
          <div class="strong">{t("import.apply.fatal")}</div>
          <div>{vm.clientsApplyError}</div>
          <div class="small" style="margin-top:4px">{t("import.clients.rollback")}</div>
        </div>
      </Show>

      <Show
        when={vm.clientsPreview}
        fallback={
          <section class="card card--elevated">
            <div class="card__head">
              <div>
                <div class="card__title">{t("import.clients.preview.title")}</div>
                <div class="card__sub">{t("import.clients.preview.subtitle")}</div>
              </div>
              <span class="status-chip status-chip--warn">
                <span class="status-chip__dot"></span>
                {t("import.clients.preview.emptyTitle")}
              </span>
            </div>
            <div class="card__body stack">
              <div class="empty">
                <div class="empty__icon">
                  <Icon name="clients" size={24} class="" />
                </div>
                <div class="empty__title">{t("import.clients.preview.emptyTitle")}</div>
                <div class="empty__text">{t("import.clients.preview.emptyText")}</div>
              </div>
            </div>
            <div class="card__foot actions-bar">
              <div class="data-toolbar__actions">
                <button class="btn" type="button" onClick={() => vm.clientsBack()}>
                  {t("import.action.back")}
                </button>
                <button
                  class="btn btn--primary"
                  type="button"
                  disabled={!vm.canPreviewClients}
                  onClick={() => vm.previewClientsNow()}
                >
                  {t("import.clients.action.preview")}
                </button>
              </div>
            </div>
          </section>
        }
      >
        <section class="card card--elevated">
          <div class="card__head">
            <div>
              <div class="card__title">{t("import.clients.preview.title")}</div>
              <div class="card__sub">{t("import.clients.preview.subtitle")}</div>
            </div>
            <Show when={vm.clientInterfaceId === ""}>
              <span class="status-chip status-chip--info">
                <span class="status-chip__dot"></span>
                {t("import.clients.preview.auto")}
              </span>
            </Show>
          </div>
          <div class="card__body stack">
            <div class="row wrap">
              <span class="status-chip status-chip--ok">
                <span class="status-chip__dot"></span>
                {t("import.preview.summary.create")}: {vm.clientsPreviewSummary?.create ?? 0}
              </span>
              <span class="status-chip status-chip--neutral">
                <span class="status-chip__dot"></span>
                {t("import.preview.summary.unchanged")}: {vm.clientsPreviewSummary?.unchanged ?? 0}
              </span>
              <span class="status-chip status-chip--info">
                <span class="status-chip__dot"></span>
                {t("import.preview.summary.update")}: {vm.clientsPreviewSummary?.update ?? 0}
              </span>
              <span class="status-chip status-chip--warn">
                <span class="status-chip__dot"></span>
                {t("import.preview.summary.duplicate")}: {vm.clientsPreviewSummary?.duplicate ?? 0}
              </span>
              <span class="status-chip status-chip--error">
                <span class="status-chip__dot"></span>
                {t("import.preview.summary.error")}: {vm.clientsPreviewSummary?.error ?? 0}
              </span>
            </div>

            <div class="table-wrap">
              <table class="table table--cards table--fixed" aria-label={t("import.clients.preview.title")}>
                <thead>
                  <tr>
                    <th>{t("import.clients.preview.interface")}</th>
                    <th>{t("import.clients.preview.group")}</th>
                    <th>{t("import.preview.client")}</th>
                    <th>{t("import.preview.status")}</th>
                    <th>{t("import.preview.address")}</th>
                    <th>{t("import.preview.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={vm.clientsPreviewInterfaces}>
                    {(iface) => (
                      <For each={iface.clients}>
                        {(client) => {
                          const changesKey = vm.changesKey(iface.id, client);
                          return (
                            <tr>
                              <td data-label={t("import.clients.preview.interface")}>
                                <div class="strong mono">{iface.name}</div>
                                <div class="xs muted">
                                  {t("import.clients.preview.node")}: {iface.node_id}
                                </div>
                              </td>
                              <td data-label={t("import.clients.preview.group")} class="small">
                                {iface.group_name}
                              </td>
                              <td data-label={t("import.preview.client")}>
                                <span class="strong">{client.name}</span>
                              </td>
                              <td data-label={t("import.preview.status")}>
                                <div class="stack-sm">
                                  <div class="row-between wrap">
                                    <span class={`status-chip status-chip--${clientTone(client.status)}`}>
                                      <span class="status-chip__dot"></span>
                                      {vm.previewStatusLabel(client.status)}
                                    </span>
                                    <Show when={client.changes.length > 0}>
                                      <button
                                        class="btn btn--sm btn--ghost"
                                        type="button"
                                        aria-expanded={vm.changesOpen(changesKey)}
                                        onClick={() => vm.toggleChanges(changesKey)}
                                      >
                                        {vm.changesOpen(changesKey)
                                          ? t("import.preview.changes.hide")
                                          : t("import.preview.changes.show")}
                                      </button>
                                    </Show>
                                  </div>
                                  <Show when={vm.changesOpen(changesKey)}>
                                    <div class="stack-sm">
                                      <div class="xs strong">{t("import.preview.changes")}</div>
                                      <ul style="margin:0;padding-left:16px">
                                        <For each={client.changes}>
                                          {(change) => (
                                            <li class="xs muted">
                                              <span class="strong">
                                                {vm.clientChangeLabel(change.field)}
                                              </span>
                                              : {vm.clientChangeText(change)}
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </div>
                                  </Show>
                                </div>
                              </td>
                              <td data-label={t("import.preview.address")} class="mono small">
                                {vm.previewClientAddress(client)}
                              </td>
                              <td data-label={t("import.preview.reason")} class="small">
                                {vm.previewClientReason(client)}
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <Show when={vm.clientsPreviewWarnings.length > 0}>
              <div class="alert alert--warn">
                <div class="strong">{t("import.preview.warnings")}</div>
                <ul style="margin:8px 0 0;padding-left:18px">
                  <For each={vm.clientsPreviewWarnings}>
                    {(warning) => <li class="small">{warning}</li>}
                  </For>
                </ul>
              </div>
            </Show>
          </div>
          <div class="card__foot actions-bar">
            <div class="data-toolbar__actions">
              <button class="btn" type="button" onClick={() => vm.clientsBack()}>
                {t("import.action.back")}
              </button>
              <button
                class="btn"
                type="button"
                disabled={!vm.canPreviewClients}
                onClick={() => vm.previewClientsNow()}
              >
                {t("import.clients.action.recheck")}
              </button>
              <button
                class="btn btn--primary"
                type="button"
                disabled={!vm.canApplyClients}
                onClick={() => vm.applyClientsNow()}
              >
                <Show
                  when={vm.clientsApplying}
                  fallback={
                    <>
                      <Icon name="import" size={16} class="" />
                      {t("import.clients.action.apply")}
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
      </Show>
    </div>
  );
}
