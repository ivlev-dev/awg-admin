import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { RateField } from "@/components/RateField";
import { t } from "@/i18n";

export function ClientSettingsSection(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <section class="card client-section" id="client-settings" tabindex={-1}>
      <div class="card__head">
        <div>
          <h2 class="card__title" tabindex={-1}>{t("clients.details.edit.title")}</h2>
          <div class="card__sub">{t("clients.details.edit.subtitle")}</div>
        </div>
      </div>
      <div class="card__body stack">
        <div class="grid grid--2">
          <div class="field">
            <div class="xs muted">{t("clients.details.interface")}</div>
            <div class="small strong">{vm.interfaceLabel}</div>
          </div>
          <div class="field">
            <div class="xs muted">{t("clients.details.node")}</div>
            <div class="small strong">{vm.nodeLabel}</div>
          </div>
        </div>
        <div class="field">
          <label for="device-name">{t("clients.details.field.name")}</label>
          <input
            id="device-name"
            class="input"
            type="text"
            value={vm.editName}
            onInput={(event: Event) => vm.setEditName(event)}
          />
        </div>

        <div class="grid grid--2">
          <RateField
            id="device-down"
            label={t("clients.form.down")}
            value={vm.editDownKbps}
            hint={t("clients.form.limitHint")}
            onChange={(kbps) => vm.setEditDownKbps(kbps)}
          />
          <RateField
            id="device-up"
            label={t("clients.form.up")}
            value={vm.editUpKbps}
            hint={t("clients.form.limitHint")}
            onChange={(kbps) => vm.setEditUpKbps(kbps)}
          />
        </div>

        <Show when={vm.rateLimitHint}>
          <div class="alert alert--warn">{vm.rateLimitHint}</div>
        </Show>

        <Show when={!vm.isAdmin}>
          <div class="alert alert--info">
            {t("clients.details.edit.tariffNotice")}
          </div>
        </Show>

        <hr class="divider" />

        <div class="stack-sm">
          <div class="xs muted">{t("clients.details.forwarding.section")}</div>
          <div class="stack-sm" role="radiogroup" aria-label={t("clients.details.forwarding.modeAria")}>
            <For each={vm.forwardingModeOptions}>
              {(option) => (
                <label class="radio">
                  <input
                    type="radio"
                    name="forwarding-mode"
                    value={option.value}
                    checked={vm.forwardingMode === option.value}
                    onChange={() => vm.setForwardingMode(option.value)}
                  />
                  <span>
                    {option.label}
                    <Show when={option.hint}>
                      <span class="xs muted" style="margin-left:8px">{option.hint}</span>
                    </Show>
                  </span>
                </label>
              )}
            </For>
          </div>

          <Show when={vm.forwardingMode === "all"}>
            <div class="alert alert--info">
              {t("clients.details.forwarding.allNotice")}
            </div>
          </Show>

          <Show when={vm.forwardingMode === "selected"}>
            <div class="stack-sm">
              <div class="xs muted">{t("clients.details.forwarding.selectedTitle")}</div>
              <Show
                when={vm.otherDevices.length > 0}
                fallback={<div class="small muted">{t("clients.details.forwarding.noOthers")}</div>}
              >
                <For each={vm.otherDevices}>
                  {(device) => (
                    <label class="checkbox">
                      <input
                        type="checkbox"
                        checked={vm.isForwardingSelected(device.id)}
                        onChange={() => vm.toggleForwardingSelected(device.id)}
                      />
                      <span>
                        {device.name}
                        <span class="xs mono muted" style="margin-left:8px">
                          {device.addresses.join(", ")}
                        </span>
                      </span>
                    </label>
                  )}
                </For>
              </Show>
              <Show when={vm.forwardingError}>
                <div class="alert alert--error">{vm.forwardingError}</div>
              </Show>
            </div>
          </Show>
        </div>

        <div class="row" style="gap:8px">
          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.canSave}
            onClick={() => vm.save()}
          >
            <Show when={vm.saving} fallback={<span>{t("common.saveShort")}</span>}>
              <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
              <span>{t("common.saving")}</span>
            </Show>
          </button>
          <button
            class="btn"
            type="button"
            disabled={!vm.editDirty || vm.saving}
            onClick={() => void vm.cancelEdit()}
          >
            {t("common.cancelShort")}
          </button>
        </div>
      </div>
    </section>
  );
}
