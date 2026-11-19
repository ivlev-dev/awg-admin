import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM, InterfaceDraft } from "../ImportPage.vm";
import { ClientsBlock } from "./ClientsBlock";
import { PoolsBlock } from "./PoolsBlock";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function InterfaceCard(props: { vm: ImportVM; draft: InterfaceDraft; index: number }) {
  const vm = props.vm;
  const draft = props.draft;
  const index = props.index;
  return (
    <article class="card card--filled">
      <div class="card__head">
        <div>
          <div class="card__title">{t("import.interface.title", { index: index + 1 })}</div>
          <div class="card__sub">{draft.name || t("import.interface.name")}</div>
        </div>
        <div class="row wrap">
          <span class={`status-chip ${vm.serverConfigValid(index) ? "status-chip--ok" : "status-chip--warn"}`}>
            <span class="status-chip__dot"></span>
            {vm.serverConfigValid(index) ? t("import.badge.ready") : t("import.badge.waitingConfig")}
          </span>
          <button
            class="btn btn--sm btn--danger"
            type="button"
            disabled={vm.interfaces.length <= 1}
            aria-label={t("import.interfaces.remove")} title={t("import.interfaces.remove")}
            onClick={() => vm.removeInterface(index)}
          >
            <Icon name="trash" size={14} class="" />
            {t("import.interfaces.remove")}
          </button>
        </div>
      </div>
      <div class="card__body stack">
        <div class="row-between wrap">
          <span class="small muted">{t("import.interface.serverConfigHint")}</span>
          <label class="btn btn--sm" style="cursor:pointer">
            <Icon name="download" size={14} class="" />
            {t("import.interface.loadServer")}
            <input
              type="file"
              accept=".conf,.txt"
              style="display:none"
              onChange={(event: Event) => vm.setInterfaceServerFile(index, event)}
            />
          </label>
        </div>
        <div class="field">
          <label>{t("import.interface.serverConfig")}</label>
          <textarea
            class="textarea"
            rows={12}
            placeholder={t("import.interface.serverPlaceholder")}
            value={draft.serverConfig}
            onInput={(event: Event) => vm.setInterfaceServerConfig(index, event)}
          ></textarea>
        </div>
        <Show when={vm.serverConfigWarning(index)}>
          <div class="alert alert--warn">{vm.serverConfigWarning(index)}</div>
        </Show>

        <div class="grid grid--2">
          <div class="field">
            <label>{t("import.interface.name")}</label>
            <input
              class="input mono"
              type="text"
              placeholder="awg0"
              value={draft.name}
              onInput={(event: Event) => vm.setInterfaceName(index, event)}
            />
          </div>
          <div class="field">
            <label>{t("import.interface.label")}</label>
            <input
              class="input"
              type="text"
              placeholder="Office"
              value={draft.label}
              onInput={(event: Event) => vm.setInterfaceLabel(index, event)}
            />
          </div>
        </div>

        <div class="grid grid--2">
          <div class="field">
            <label>{t("import.interface.endpointHost")}</label>
            <input
              class="input mono"
              type="text"
              placeholder="vpn.example.com"
              value={draft.endpointHost}
              onInput={(event: Event) => vm.setEndpointHost(index, event)}
            />
          </div>
          <div class="field">
            <label>{t("import.interface.endpointPort")}</label>
            <input
              class="input mono"
              type="number"
              min="1"
              max="65535"
              value={draft.endpointPort}
              onInput={(event: Event) => vm.setEndpointPort(index, event)}
            />
          </div>
          <div class="field">
            <label>{t("import.interface.listenPort")}</label>
            <input
              class="input mono"
              type="number"
              min="1"
              max="65535"
              value={draft.listenPort}
              onInput={(event: Event) => vm.setListenPort(index, event)}
            />
          </div>
          <div class="field">
            <label>{t("import.interface.mtu")}</label>
            <input
              class="input mono"
              type="number"
              min="576"
              max="9000"
              value={draft.mtu}
              onInput={(event: Event) => vm.setMtu(index, event)}
            />
          </div>
        </div>

        <PoolsBlock vm={vm} draft={draft} interfaceIndex={index} />
        <ClientsBlock vm={vm} draft={draft} interfaceIndex={index} />

        <Show when={vm.interfaceIssues(index).length > 0}>
          <div class="alert alert--error">
            <div class="strong">{t("import.validation.title")}</div>
            <ul style="margin:8px 0 0;padding-left:18px">
              <For each={vm.interfaceIssues(index)}>
                {(issue) => <li class="small">{vm.issueMessage(issue)}</li>}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </article>
  );
}
