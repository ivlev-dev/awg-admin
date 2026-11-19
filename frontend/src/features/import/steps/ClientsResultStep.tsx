import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ClientsResultStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  return (
    <Show
      when={vm.clientsApplied}
      fallback={
        <section class="card card--elevated">
          <div class="card__head">
            <div>
              <div class="card__title">{t("import.clients.result.title")}</div>
            </div>
          </div>
          <div class="card__body">
            <div class="empty">
              <div class="empty__icon">
                <Icon name="clients" size={24} class="" />
              </div>
              <div class="empty__title">{t("import.clients.result.title")}</div>
              <div class="empty__text">{t("import.clients.preview.emptyText")}</div>
            </div>
          </div>
        </section>
      }
    >
      <section class="card card--elevated">
        <div class="card__head">
          <div>
            <div class="card__title">{t("import.clients.result.title")}</div>
            <div class="card__sub">{t("import.clients.result.subtitle")}</div>
          </div>
          <span class="status-chip status-chip--ok">
            <span class="status-chip__dot"></span>
            {t("import.preview.summary.create")}: {vm.clientsResultCreatedCount}
          </span>
        </div>
        <div class="card__body stack">
          <div class="grid grid--4">
            <div class="stat">
              <div class="stat__label">{t("import.clients.result.interfaces")}</div>
              <div class="stat__value">{vm.clientsResultInterfaceCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.result.devices")}</div>
              <div class="stat__value">{vm.clientsResultDeviceCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.clients.result.updated")}</div>
              <div class="stat__value">{vm.clientsResultUpdatedCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.clients.result.unchanged")}</div>
              <div class="stat__value">{vm.clientsResultUnchangedCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.preview.summary.duplicate")}</div>
              <div class="stat__value">{vm.clientsResultDuplicateCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.preview.summary.error")}</div>
              <div class="stat__value">{vm.clientsResultErrorCount}</div>
            </div>
          </div>

          <div class="stack-sm">
            <For each={vm.clientsResultInterfaces}>
              {(iface) => (
                <div class="panel summary">
                  <div class="grow">
                    <div class="strong mono">{iface.name}</div>
                    <div class="xs muted">{iface.group_name}</div>
                  </div>
                  <span class="status-chip status-chip--info">
                    <span class="status-chip__dot"></span>
                    {t("import.result.interfaceDevices", {
                      count:
                        vm.clientsApplied?.created.interfaces.find((item) => item.id === iface.id)
                          ?.device_ids.length ?? 0,
                    })}
                  </span>
                </div>
              )}
            </For>
          </div>

          <Show
            when={vm.clientsResultFailures.length > 0}
            fallback={<div class="alert alert--info">{t("import.clients.result.noFailures")}</div>}
          >
            <div class="stack-sm">
              <div class="alert alert--error">
                <div class="strong">{t("import.clients.result.failures")}</div>
              </div>
              <div class="table-wrap">
                <table class="table table--cards table--fixed" aria-label={t("import.clients.result.failures")}>
                  <thead>
                    <tr>
                      <th>{t("import.clients.preview.interface")}</th>
                      <th>{t("import.clients.preview.group")}</th>
                      <th>{t("import.result.failedClient")}</th>
                      <th>{t("import.result.failedReason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={vm.clientsResultFailures}>
                      {(failure) => (
                        <tr>
                          <td data-label={t("import.clients.preview.interface")} class="mono small">
                            {failure.interfaceName}
                          </td>
                          <td data-label={t("import.clients.preview.group")} class="small">
                            {failure.groupName}
                          </td>
                          <td data-label={t("import.result.failedClient")}>
                            <span class="strong">{failure.clientName}</span>
                          </td>
                          <td data-label={t("import.result.failedReason")} class="small">
                            {failure.reason}
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
        <div class="card__foot actions-bar">
          <div class="data-toolbar__actions">
            <button class="btn btn--primary" type="button" onClick={() => vm.openClientsGroup()}>
              <Icon name="groups" size={16} class="" />
              {t("import.clients.result.openGroup")}
            </button>
            <button class="btn" type="button" onClick={() => vm.openInterfaces()}>
              <Icon name="interfaces" size={16} class="" />
              {t("import.clients.result.openInterfaces")}
            </button>
            <button class="btn" type="button" onClick={() => vm.resetClientsImport()}>
              {t("import.clients.result.newImport")}
            </button>
          </div>
        </div>
      </section>
    </Show>
  );
}
