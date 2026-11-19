import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "../ImportPage.vm";
import { InterfaceCard } from "./InterfaceCard";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function InterfacesStep(props: { vm: ImportVM }) {
  const vm = props.vm;
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
              {(draft, index) => (
                <InterfaceCard vm={vm} draft={draft} index={index()} />
              )}
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
