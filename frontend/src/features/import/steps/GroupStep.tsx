import { Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function GroupStep(props: { vm: ImportVM }) {
  const vm = props.vm;
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
