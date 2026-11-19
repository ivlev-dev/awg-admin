import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function ClientsFormStep(props: { vm: ImportVM }) {
  const vm = props.vm;
  return (
    <section class="card card--elevated">
      <div class="card__head">
        <div>
          <div class="card__title">{t("import.clients.title")}</div>
          <div class="card__sub">{t("import.clients.subtitle")}</div>
        </div>
        <span class={`status-chip ${vm.clientsValid ? "status-chip--ok" : "status-chip--warn"}`}>
          <span class="status-chip__dot"></span>
          {t("import.badge.count", { count: vm.clientsTotal })}
        </span>
      </div>
      <div class="card__body stack">
        <div class="list-toolbar">
          <div class="field field--compact">
            <label for="import-client-owner">{t("import.clients.owner")}</label>
            <Show
              when={!vm.ownersLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-client-owner"
                value={vm.clientOwnerUserId}
                options={vm.ownerOptions}
                onChange={(value) => vm.setClientOwner(value)}
                disabled={vm.owners.length === 0}
                placeholder={t("import.owner.none")}
                ariaLabel={t("import.clients.owner")}
              />
            </Show>
            <Show when={vm.ownersError}>
              <div class="hint" style="color:var(--md-error)">{vm.ownersError}</div>
            </Show>
          </div>

          <div class="field field--compact">
            <label for="import-client-interface">{t("import.clients.interface")}</label>
            <Show
              when={!vm.interfacesLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-client-interface"
                value={vm.clientInterfaceId}
                options={vm.interfaceOptions}
                onChange={(value) => vm.setClientInterface(value)}
                disabled={vm.interfaceList.length === 0}
                placeholder={t("import.clients.interfaceAuto")}
                ariaLabel={t("import.clients.interface")}
              />
            </Show>
            <Show when={vm.interfacesError}>
              <div class="hint" style="color:var(--md-error)">{vm.interfacesError}</div>
            </Show>
          </div>
        </div>

        <div class="section-title">
          <h2>{t("import.clients.configsTitle")}</h2>
          <span class={`status-chip ${vm.clientsTotal > 0 ? "status-chip--ok" : "status-chip--neutral"}`}>
            <span class="status-chip__dot"></span>
            {t("import.badge.count", { count: vm.clientsTotal })}
          </span>
        </div>

        <div class="field">
          <textarea
            class="textarea"
            rows={10}
            placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = 10.8.0.2/24&#10;...&#10;---&#10;[Interface]&#10;..."
            value={vm.clientsImportText}
            onInput={(event: Event) => vm.setClientsImportText(event)}
          ></textarea>
        </div>

        <div class="actions-bar">
          <button class="btn btn--sm" type="button" onClick={() => vm.parseClientsImport()}>
            <Icon name="import" size={14} class="" />
            {t("import.interface.parse")}
          </button>
          <label class="btn btn--sm" style="cursor:pointer">
            <Icon name="download" size={14} class="" />
            {t("import.interface.uploadClients")}
            <input
              type="file"
              accept=".conf,.txt"
              multiple
              style="display:none"
              onChange={(event: Event) => vm.setClientsImportFiles(event)}
            />
          </label>
          <span class="xs muted">{t("import.clients.configsHint")}</span>
        </div>

        <Show
          when={vm.clientsImport.length > 0}
          fallback={
            <div class="empty">
              <div class="empty__icon">
                <Icon name="clients" size={24} class="" />
              </div>
              <div class="empty__title">{t("import.interface.clientsEmptyTitle")}</div>
              <div class="empty__text">{t("import.clients.validation")}</div>
            </div>
          }
        >
          <div class="stack-sm">
            <For each={vm.clientsImport}>
              {(client, index) => (
                <div class="card card--filled">
                  <div class="card__body stack-sm">
                    <div class="row-between wrap">
                      <div class="field grow">
                        <label>{t("import.interface.clientName")}</label>
                        <input
                          class="input"
                          type="text"
                          value={client.name}
                          onInput={(event: Event) => vm.setClientsImportName(index(), event)}
                        />
                      </div>
                      <button
                        class="btn btn--sm btn--ghost btn--icon"
                        type="button"
                        aria-label={t("import.interface.removeClient")} title={t("import.interface.removeClient")}
                        onClick={() => vm.removeClientsImport(index())}
                      >
                        <Icon name="trash" size={16} class="" />
                      </button>
                    </div>
                    <div class="row wrap">
                      <span class="status-chip status-chip--info">{vm.clientAddress(client.config)}</span>
                      <Show
                        when={vm.clientPeerKey(client.config)}
                        fallback={
                          <span class="status-chip status-chip--warn">
                            {t("import.interface.noPublicKey")}
                          </span>
                        }
                      >
                        <span class="status-chip status-chip--neutral mono truncate" style="max-width:100%">
                          {vm.clientPeerKey(client.config)}
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={vm.clientsPlanInvalidated}>
          <div class="alert alert--warn">{t("import.clients.stale")}</div>
        </Show>
      </div>
      <div class="card__foot actions-bar">
        <div class="data-toolbar__actions">
          <button class="btn" type="button" onClick={() => vm.resetClientsImport()}>
            {t("import.action.reset")}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.canPreviewClients}
            onClick={() => vm.clientsNext()}
          >
            <Show
              when={vm.clientsPreviewing}
              fallback={
                <>
                  <Icon name="check" size={16} class="" />
                  {t("import.clients.action.preview")}
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
  );
}
