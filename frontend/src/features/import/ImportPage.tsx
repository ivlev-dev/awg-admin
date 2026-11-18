import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportStep, ImportVM, InterfaceDraft } from "./ImportPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { t, type TranslationKey } from "@/i18n";

const STEPS: ReadonlyArray<{ step: ImportStep; labelKey: TranslationKey }> = [
  { step: 1, labelKey: "import.steps.group" },
  { step: 2, labelKey: "import.steps.interfaces" },
  { step: 3, labelKey: "import.steps.preview" },
  { step: 4, labelKey: "import.steps.result" },
];

type StatusTone = "ok" | "warn" | "error" | "info" | "neutral";

function clientTone(status: string): StatusTone {
  switch (status) {
    case "create":
      return "ok";
    case "update":
      return "info";
    case "duplicate":
      return "warn";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

function peerTone(status: string): StatusTone {
  switch (status) {
    case "create":
      return "ok";
    case "duplicate":
      return "warn";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

function stepChip(vm: ImportVM, step: ImportStep, labelKey: TranslationKey) {
  return (
    <button
      class={`chip ${vm.step === step ? "is-selected" : ""}`}
      type="button"
      aria-current={vm.step === step ? "step" : undefined}
      onClick={() => vm.goToStep(step)}
    >
      <span class="strong">
        {vm.isStepDone(step) ? <Icon name="check" size={14} class="" /> : step}
      </span>
      <span>{t(labelKey)}</span>
    </button>
  );
}

function groupStep(vm: ImportVM) {
  return (
    <section class="card card--elevated">
      <div class="card__head">
        <div>
          <div class="card__title">{t("import.group.title")}</div>
          <div class="card__sub">{t("import.group.subtitle")}</div>
        </div>
        <span class={`status-chip ${vm.groupValid ? "status-chip--ok" : "status-chip--warn"}`}>
          <span class="status-chip__dot"></span>
          {vm.groupValid ? t("import.badge.ready") : t("import.badge.fillFields")}
        </span>
      </div>
      <div class="card__body stack">
        <div class="grid grid--2">
          <div class="field">
            <label for="import-group-name">{t("import.field.groupName")}</label>
            <input
              id="import-group-name"
              class="input"
              type="text"
              placeholder={t("import.field.groupNamePlaceholder")}
              value={vm.groupName}
              onInput={(event: Event) => vm.setGroupName(event)}
            />
          </div>
          <div class="field">
            <label for="import-base-cidr">{t("import.field.baseCidr")}</label>
            <input
              id="import-base-cidr"
              class="input mono"
              type="text"
              placeholder="10.8.0.0/24"
              value={vm.baseCidr}
              onInput={(event: Event) => vm.setBaseCidr(event)}
            />
            <Show when={vm.baseCidr.trim().length > 0 && vm.baseCidrError !== null}>
              <div class="hint" style="color:var(--md-error)">{vm.baseCidrError}</div>
            </Show>
          </div>
        </div>

        <div class="field">
          <label for="import-group-description">{t("import.field.groupDescription")}</label>
          <input
            id="import-group-description"
            class="input"
            type="text"
            placeholder={t("import.field.groupDescriptionPlaceholder")}
            value={vm.groupDescription}
            onInput={(event: Event) => vm.setGroupDescription(event)}
          />
        </div>

        <div class="list-toolbar">
          <div class="field field--compact">
            <label for="import-node">{t("import.field.node")}</label>
            <Show
              when={!vm.nodesLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-node"
                value={vm.nodeId}
                options={vm.nodeOptions}
                onChange={(value) => vm.setNode(value)}
                disabled={vm.nodes.length === 0}
                placeholder={t("import.nodes.empty")}
                ariaLabel={t("import.field.node")}
              />
            </Show>
            <Show when={vm.nodesError}>
              <div class="hint" style="color:var(--md-error)">{vm.nodesError}</div>
            </Show>
            <Show when={!vm.nodesLoading && vm.nodes.length === 0}>
              <button class="btn btn--sm btn--ghost" type="button" onClick={() => vm.openNodes()}>
                {t("import.action.nodes")}
              </button>
            </Show>
          </div>

          <div class="field field--compact">
            <label for="import-owner">{t("import.field.owner")}</label>
            <Show
              when={!vm.ownersLoading}
              fallback={<div class="skeleton" style="height:40px"></div>}
            >
              <Select
                id="import-owner"
                value={vm.ownerUserId}
                options={vm.ownerOptions}
                onChange={(value) => vm.setOwner(value)}
                disabled={vm.owners.length === 0}
                placeholder={t("import.owner.none")}
                ariaLabel={t("import.field.owner")}
              />
            </Show>
            <Show when={vm.ownersError}>
              <div class="hint" style="color:var(--md-error)">{vm.ownersError}</div>
            </Show>
          </div>
        </div>
      </div>
      <div class="card__foot actions-bar">
        <div class="data-toolbar__actions">
          <button class="btn" type="button" onClick={() => vm.reset()}>
            {t("import.action.reset")}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.groupValid}
            onClick={() => vm.next()}
          >
            {t("import.action.next")}
          </button>
        </div>
      </div>
    </section>
  );
}

function poolsBlock(vm: ImportVM, draft: InterfaceDraft, interfaceIndex: number) {
  return (
    <div class="stack-sm">
      <div class="section-title">
        <h2>{t("import.pools.title")}</h2>
        <button class="btn btn--sm btn--tonal" type="button" onClick={() => vm.addPool(interfaceIndex)}>
          <Icon name="plus" size={14} class="" />
          {t("import.pools.add")}
        </button>
      </div>

      <Show
        when={draft.pools.length > 0}
        fallback={
          <div class="empty">
            <div class="empty__icon">
              <Icon name="interfaces" size={24} class="" />
            </div>
            <div class="empty__title">{t("import.pools.emptyTitle")}</div>
            <div class="empty__text">{t("import.pools.emptyText")}</div>
          </div>
        }
      >
        <div class="stack-sm">
          <For each={draft.pools}>
            {(pool, poolIndex) => (
              <div class="card card--filled">
                <div class="card__body stack-sm">
                  <div class="grid grid--2">
                    <div class="field">
                      <label>{t("import.pool.name")}</label>
                      <input
                        class="input"
                        type="text"
                        placeholder="default"
                        value={pool.name}
                        onInput={(event: Event) => vm.setPoolName(interfaceIndex, poolIndex(), event)}
                      />
                    </div>
                    <div class="field">
                      <label>{t("import.pool.cidr")}</label>
                      <input
                        class="input mono"
                        type="text"
                        placeholder="10.8.0.0/24"
                        value={pool.cidr}
                        onInput={(event: Event) => vm.setPoolCidr(interfaceIndex, poolIndex(), event)}
                      />
                    </div>
                    <div class="field">
                      <label>{t("import.pool.mode")}</label>
                      <Select
                        value={pool.mode}
                        options={[
                          { value: "auto", label: t("import.pool.mode.auto") },
                          { value: "rf_only", label: t("import.pool.mode.rfOnly") },
                          { value: "external_only", label: t("import.pool.mode.externalOnly") },
                        ]}
                        onChange={(value) => vm.setPoolMode(interfaceIndex, poolIndex(), value)}
                        ariaLabel={t("import.pool.mode")}
                      />
                    </div>
                    <div class="field">
                      <label>{t("import.pool.gateway")}</label>
                      <input
                        class="input mono"
                        type="text"
                        placeholder={t("import.pool.gatewayPlaceholder")}
                        value={pool.gateway}
                        onInput={(event: Event) => vm.setPoolGateway(interfaceIndex, poolIndex(), event)}
                      />
                    </div>
                  </div>
                  <Show when={vm.poolError(interfaceIndex, poolIndex())}>
                    <div class="hint" style="color:var(--md-error)">
                      {vm.poolError(interfaceIndex, poolIndex())}
                    </div>
                  </Show>
                  <div class="row-between wrap">
                    <span class="xs muted">
                      {t("import.pool.inBase", { cidr: vm.baseCidr || t("import.preview.none") })}
                    </span>
                    <button
                      class="btn btn--sm btn--danger"
                      type="button"
                      onClick={() => vm.removePool(interfaceIndex, poolIndex())}
                    >
                      <Icon name="trash" size={14} class="" />
                      {t("import.pools.remove")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function clientsBlock(vm: ImportVM, draft: InterfaceDraft, interfaceIndex: number) {
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
                      aria-label={t("import.interface.removeClient")}
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

function interfaceCard(vm: ImportVM, draft: InterfaceDraft, index: number) {
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
            aria-label={t("import.interfaces.remove")}
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

        {poolsBlock(vm, draft, index)}
        {clientsBlock(vm, draft, index)}

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

function interfacesStep(vm: ImportVM) {
  return (
    <section class="card card--elevated">
      <div class="card__head">
        <div>
          <div class="card__title">{t("import.interfaces.title")}</div>
          <div class="card__sub">{t("import.interfaces.subtitle")}</div>
        </div>
        <div class="row wrap">
          <span class={`status-chip ${vm.valid ? "status-chip--ok" : "status-chip--warn"}`}>
            <span class="status-chip__dot"></span>
            {vm.valid ? t("import.badge.ready") : t("import.badge.fillFields")}
          </span>
          <button class="btn btn--sm btn--tonal" type="button" onClick={() => vm.addInterface()}>
            <Icon name="plus" size={14} class="" />
            {t("import.interfaces.add")}
          </button>
        </div>
      </div>
      <div class="card__body stack">
        <div class="alert alert--info">{t("import.warn.publicKey")}</div>

        <Show
          when={vm.interfaces.length > 0}
          fallback={
            <div class="empty">
              <div class="empty__icon">
                <Icon name="interfaces" size={24} class="" />
              </div>
              <div class="empty__title">{t("import.interfaces.emptyTitle")}</div>
              <div class="empty__text">{t("import.interfaces.emptyText")}</div>
            </div>
          }
        >
          <div class="stack">
            <For each={vm.interfaces}>
              {(draft, index) => interfaceCard(vm, draft, index())}
            </For>
          </div>
        </Show>

        <Show when={vm.planInvalidated}>
          <div class="alert alert--warn">{t("import.preview.stale")}</div>
        </Show>

        <Show when={!vm.valid}>
          <div class="alert alert--warn">{t("import.validation.hasErrors")}</div>
        </Show>
      </div>
      <div class="card__foot actions-bar">
        <div class="data-toolbar__actions">
          <button class="btn" type="button" onClick={() => vm.back()}>
            {t("import.action.back")}
          </button>
          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.canPreview}
            onClick={() => vm.next()}
          >
            <Icon name="check" size={16} class="" />
            {t("import.preview.action")}
          </button>
        </div>
      </div>
    </section>
  );
}

function previewStep(vm: ImportVM) {
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

function resultStep(vm: ImportVM) {
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

function clientsFormStep(vm: ImportVM) {
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
                        aria-label={t("import.interface.removeClient")}
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

function clientsPreviewStep(vm: ImportVM) {
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

function clientsResultStep(vm: ImportVM) {
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

function clientsSection(vm: ImportVM) {
  return (
    <div class="stack">
      <Show when={vm.clientsStep === 1}>{clientsFormStep(vm)}</Show>
      <Show when={vm.clientsStep === 2}>{clientsPreviewStep(vm)}</Show>
      <Show when={vm.clientsStep === 3}>{clientsResultStep(vm)}</Show>
    </div>
  );
}

export function ImportPage(this: { vm: ImportVM }) {
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("import.eyebrow")}</div>
        <h1>{t("import.title")}</h1>
        <p>{t("import.subtitle")}</p>
      </div>

      <div class="tabs">
        <button
          class={`tab ${this.vm.mode === "group" ? "is-active" : ""}`}
          type="button"
          onClick={() => this.vm.setMode("group")}
        >
          {t("import.mode.group")}
        </button>
        <button
          class={`tab ${this.vm.mode === "clients" ? "is-active" : ""}`}
          type="button"
          onClick={() => this.vm.setMode("clients")}
        >
          {t("import.mode.clients")}
        </button>
      </div>

      <Show when={this.vm.mode === "group"}>
        <section class="card card--filled">
          <div class="card__body">
            <div class="row wrap">
              <For each={STEPS}>
                {(item) => stepChip(this.vm, item.step, item.labelKey)}
              </For>
              <span class="xs muted" style="margin-left:auto">
                {t("import.step.of", { step: this.vm.step })}
              </span>
            </div>
          </div>
        </section>

        <Show when={this.vm.step === 1}>{groupStep(this.vm)}</Show>
        <Show when={this.vm.step === 2}>{interfacesStep(this.vm)}</Show>
        <Show when={this.vm.step === 3}>{previewStep(this.vm)}</Show>
        <Show when={this.vm.step === 4}>{resultStep(this.vm)}</Show>
      </Show>

      <Show when={this.vm.mode === "clients"}>{clientsSection(this.vm)}</Show>
    </div>
  );
}
