import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ResultStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  return (
    <Show
      when={vm.applied}
      fallback={
        <section class="card card--elevated">
          <div class="card__head">
            <div>
              <div class="card__title">{t("import.result.title")}</div>
            </div>
          </div>
          <div class="card__body">
            <div class="empty">
              <div class="empty__icon">
                <Icon name="import" size={24} class="" />
              </div>
              <div class="empty__title">{t("import.result.title")}</div>
              <div class="empty__text">{t("import.preview.emptyText")}</div>
            </div>
          </div>
        </section>
      }
    >
      <section class="card card--elevated">
        <div class="card__head">
          <div>
            <div class="card__title">{t("import.result.title")}</div>
            <div class="card__sub">{t("import.result.subtitle")}</div>
          </div>
          <span class="status-chip status-chip--info">
            <span class="status-chip__dot"></span>
            {t("import.result.group", { id: vm.resultGroupId })}
          </span>
        </div>
        <div class="card__body stack">
          <div class="grid grid--4">
            <div class="stat">
              <div class="stat__label">{t("import.result.interfaces")}</div>
              <div class="stat__value">{vm.resultInterfaceCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.result.devices")}</div>
              <div class="stat__value">{vm.resultDeviceCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.result.externalDevices")}</div>
              <div class="stat__value">{vm.resultExternalCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.preview.summary.duplicate")}</div>
              <div class="stat__value">{vm.resultDuplicateCount}</div>
            </div>
            <div class="stat">
              <div class="stat__label">{t("import.preview.summary.error")}</div>
              <div class="stat__value">{vm.resultErrorCount}</div>
            </div>
          </div>

          <div class="stack-sm">
            <For each={vm.resultInterfaces}>
              {(iface) => (
                <div class="panel summary">
                  <div class="grow">
                    <div class="strong mono">{iface.name}</div>
                  </div>
                  <span class="status-chip status-chip--info">
                    <span class="status-chip__dot"></span>
                    {t("import.result.interfaceDevices", { count: iface.device_ids.length })}
                  </span>
                </div>
              )}
            </For>
          </div>

          <Show
            when={vm.resultFailures.length > 0}
            fallback={<div class="alert alert--info">{t("import.result.noFailures")}</div>}
          >
            <div class="stack-sm">
              <div class="alert alert--error">
                <div class="strong">{t("import.result.failures")}</div>
              </div>
              <div class="table-wrap">
                <table class="table table--cards table--fixed" aria-label={t("import.result.failures")}>
                  <thead>
                    <tr>
                      <th>{t("import.preview.interface")}</th>
                      <th>{t("import.result.failedClient")}</th>
                      <th>{t("import.result.failedReason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={vm.resultFailures}>
                      {(failure) => (
                        <tr>
                          <td data-label={t("import.preview.interface")} class="mono small">
                            {failure.interfaceName}
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
            <button class="btn btn--primary" type="button" onClick={() => vm.openGroup()}>
              <Icon name="groups" size={16} class="" />
              {t("import.result.openGroup")}
            </button>
            <button class="btn" type="button" onClick={() => vm.openInterfaces()}>
              <Icon name="interfaces" size={16} class="" />
              {t("import.result.openInterfaces")}
            </button>
            <button class="btn" type="button" onClick={() => vm.reset()}>
              {t("import.result.newImport")}
            </button>
          </div>
        </div>
      </section>
    </Show>
  );
}
