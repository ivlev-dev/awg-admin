import { For, Show } from "@ivlev-dev/silent-core";

import type { ImportVM } from "./ImportPage.vm";
import { ClientsFormStep } from "./steps/ClientsFormStep";
import { ClientsPreviewStep } from "./steps/ClientsPreviewStep";
import { ClientsResultStep } from "./steps/ClientsResultStep";
import { GroupStep } from "./steps/GroupStep";
import { InterfacesStep } from "./steps/InterfacesStep";
import { PreviewStep } from "./steps/PreviewStep";
import { ResultStep } from "./steps/ResultStep";
import { STEPS, StepChip } from "./steps/StepChip";
import { t } from "@/i18n";

export function ImportPage(this: { vm: ImportVM }) {
  const vm = this.vm;
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("import.eyebrow")}</div>
        <h1>{t("import.title")}</h1>
        <p>{t("import.subtitle")}</p>
      </div>

      <div class="tabs">
        <button
          class={`tab ${vm.mode === "group" ? "is-active" : ""}`}
          type="button"
          onClick={() => vm.setMode("group")}
        >
          {t("import.mode.group")}
        </button>
        <button
          class={`tab ${vm.mode === "clients" ? "is-active" : ""}`}
          type="button"
          onClick={() => vm.setMode("clients")}
        >
          {t("import.mode.clients")}
        </button>
      </div>

      <Show when={vm.mode === "group"}>
        <section class="card card--filled">
          <div class="card__body">
            <div class="row wrap">
              <For each={STEPS}>
                {(item) => <StepChip vm={vm} step={item.step} labelKey={item.labelKey} />}
              </For>
              <span class="xs muted" style="margin-left:auto">
                {t("import.step.of", { step: vm.step })}
              </span>
            </div>
          </div>
        </section>

        <Show when={vm.step === 1}>{GroupStep({ vm })}</Show>
        <Show when={vm.step === 2}>{InterfacesStep({ vm })}</Show>
        <Show when={vm.step === 3}>{PreviewStep({ vm })}</Show>
        <Show when={vm.step === 4}>{ResultStep({ vm })}</Show>
      </Show>

      <Show when={vm.mode === "clients"}>
        <div class="stack">
          <Show when={vm.clientsStep === 1}>{ClientsFormStep({ vm })}</Show>
          <Show when={vm.clientsStep === 2}>{ClientsPreviewStep({ vm })}</Show>
          <Show when={vm.clientsStep === 3}>{ClientsResultStep({ vm })}</Show>
        </div>
      </Show>
    </div>
  );
}
