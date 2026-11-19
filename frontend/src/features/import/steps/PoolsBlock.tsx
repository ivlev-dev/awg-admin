import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM, InterfaceDraft } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function PoolsBlock(props: { vm: ImportVM; draft: InterfaceDraft; interfaceIndex: number }) {
  const vm = props.vm;
  const draft = props.draft;
  const interfaceIndex = props.interfaceIndex;
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
