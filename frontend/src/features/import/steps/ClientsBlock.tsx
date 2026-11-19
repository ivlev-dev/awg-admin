import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM, InterfaceDraft } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ClientsBlock(props: { vm: ImportVM; draft: InterfaceDraft; interfaceIndex: number }) {
  const vm = props.vm;
  const draft = props.draft;
  const interfaceIndex = props.interfaceIndex;
  return (
    <div class="stack-sm">
      <div class="section-title">
        <h2>{t("import.interface.clientsTitle")}</h2>
        <span class={`status-chip ${draft.clients.length > 0 ? "status-chip--ok" : "status-chip--warn"}`}>
          <span class="status-chip__dot"></span>
          {t("import.badge.count", { count: draft.clients.length })}
        </span>
      </div>

      <div class="field">
        <textarea
          class="textarea"
          rows={8}
          placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = 10.8.0.2/24&#10;...&#10;---&#10;[Interface]&#10;..."
          value={draft.clientsText}
          onInput={(event: Event) => vm.setClientsText(interfaceIndex, event)}
        ></textarea>
      </div>

      <div class="actions-bar">
        <button class="btn btn--sm" type="button" onClick={() => vm.parseClients(interfaceIndex)}>
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
            onChange={(event: Event) => vm.setClientFiles(interfaceIndex, event)}
          />
        </label>
        <span class="xs muted">{t("import.interface.syncHint")}</span>
      </div>

      <Show when={vm.clientKeysMismatch(interfaceIndex)}>
        <div class="alert alert--warn">{t("import.warn.clientKeysMismatch")}</div>
      </Show>
      <Show when={vm.clientsWithoutKey(interfaceIndex) > 0}>
        <div class="alert alert--warn">
          {t("import.warn.clientsWithoutKey", { count: vm.clientsWithoutKey(interfaceIndex) })}
        </div>
      </Show>

      <Show
        when={draft.clients.length > 0}
        fallback={
          <div class="empty">
            <div class="empty__icon">
              <Icon name="clients" size={24} class="" />
            </div>
            <div class="empty__title">{t("import.interface.clientsEmptyTitle")}</div>
            <div class="empty__text">{t("import.interface.clientsEmptyText")}</div>
          </div>
        }
      >
        <div class="stack-sm">
          <For each={draft.clients}>
            {(client, clientIndex) => (
              <div class="card card--filled">
                <div class="card__body stack-sm">
                  <div class="row-between wrap">
                    <div class="field grow">
                      <label>{t("import.interface.clientName")}</label>
                      <input
                        class="input"
                        type="text"
                        value={client.name}
                        onInput={(event: Event) =>
                          vm.setClientName(interfaceIndex, clientIndex(), event)
                        }
                      />
                    </div>
                    <button
                      class="btn btn--sm btn--ghost btn--icon"
                      type="button"
                      aria-label={t("import.interface.removeClient")} title={t("import.interface.removeClient")}
                      onClick={() => vm.removeClient(interfaceIndex, clientIndex())}
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
                  <pre class="code code--light" style="max-height:150px">{vm.clientPreview(client.config)}</pre>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
