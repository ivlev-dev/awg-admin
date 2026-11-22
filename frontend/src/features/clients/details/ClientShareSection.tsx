import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { Select } from "@/components/Select";
import { t } from "@/i18n";
import { formatDateTimeI18n } from "@/i18n/format";

export function ClientShareSection(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  const form = vm.shareForm;
  const maxUsesField = form.getFieldProps("maxUses");
  const ttlField = form.getFieldProps("ttl");
  const formatField = form.getFieldProps("format");
  return (
    <section class="card client-section" id="client-share" tabindex={-1}>
      <div class="card__head">
        <div>
          <h2 class="card__title" tabindex={-1}>{t("clients.details.share.title")}</h2>
          <div class="card__sub">{t("clients.details.share.subtitle")}</div>
        </div>
        <button
          class="btn btn--sm btn--danger"
          type="button"
          disabled={!vm.hasActiveShares || vm.shareBusy}
          aria-label={t("clients.details.share.revokeAllAria")} title={t("clients.details.share.revokeAllAria")}
          onClick={() => { void vm.revokeAllShares(); }}
        >
          <Icon name="trash" size={14} class="" /> {t("clients.details.share.revokeAll")}
        </button>
      </div>
      <div class="card__body stack">
        <Show
          when={vm.profiles.length > 0}
          fallback={<div class="small muted">{t("clients.details.share.noPeers")}</div>}
        >
          <div class="grid grid--3">
            <div class="field">
              <label for="share-interface">{t("clients.details.share.interface")}</label>
              <Select
                id="share-interface"
                value={vm.shareInterfaceId}
                options={vm.shareInterfaceOptions.map((option) => ({ value: option.value, label: option.label }))}
                onChange={(value) => vm.setShareInterface(value)}
                ariaLabel={t("clients.details.share.interface")}
              />
            </div>
            <div class="field">
              <label for="share-format">{t("clients.details.share.format")}</label>
              <Select
                id="share-format"
                value={formatField.value}
                options={vm.formatOptions.map((option) => ({ value: option.value, label: option.label }))}
                onChange={(value) => vm.setShareFormat(value)}
                ariaLabel={t("clients.details.share.format")}
              />
            </div>
            <div class="field">
              <label for="share-ttl">{t("clients.details.share.ttl")}</label>
              <Select
                id="share-ttl"
                value={String(ttlField.value)}
                options={vm.ttlOptions.map((option) => ({ value: String(option.value), label: option.label }))}
                onChange={(value) => vm.setShareTtl(value)}
                ariaLabel={t("clients.details.share.ttl")}
              />
              <Show when={ttlField.error}>
                <div class="hint hint--error">{ttlField.error}</div>
              </Show>
            </div>
          </div>

          <div class="grid grid--2">
            <label class="switch">
              <input
                type="checkbox"
                checked={form.oneTime}
                onChange={(event: Event) => vm.setShareOneTime(event)}
              />
              <span class="track"></span>
              <span>
                {t("clients.details.share.oneTime")}
                <span class="xs muted" style="margin-left:8px">
                  {t("clients.details.share.oneTimeHint")}
                </span>
              </span>
            </label>
            <div class="field">
              <label for="share-max-uses">{t("clients.details.share.maxUses")}</label>
              <input
                id="share-max-uses"
                class="input"
                type="number"
                min="1"
                max="1000"
                step="1"
                value={vm.shareMaxUses}
                disabled={vm.shareOneTime}
                aria-invalid={vm.shareMaxUsesInvalid}
                placeholder={t("clients.details.share.maxUsesHint")}
                onInput={(event: Event) =>
                  vm.setShareMaxUses((event.target as HTMLInputElement).value)
                }
                onBlur={maxUsesField.onBlur}
              />
              <Show
                when={maxUsesField.error}
                fallback={<div class="hint">{t("clients.details.share.maxUsesHint")}</div>}
              >
                <div class="hint hint--error">{maxUsesField.error}</div>
              </Show>
            </div>
          </div>

          <button
            class="btn btn--primary"
            type="button"
            disabled={!vm.canCreateShare}
            onClick={() => vm.createShare()}
          >
            <Show
              when={vm.shareBusy}
              fallback={
                <span class="row" style="gap:6px">
                  <Icon name="link" size={14} class="" /> {t("clients.details.share.create")}
                </span>
              }
            >
              <span class="spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>
              <span>{t("clients.details.share.creating")}</span>
            </Show>
          </button>
        </Show>

        <hr class="divider" />

        <Show
          when={vm.shares.length > 0}
          fallback={<div class="small muted">{t("clients.details.share.none")}</div>}
        >
          <div class="stack-sm">
            <For each={vm.shares}>
              {(share) => (
                <div class="panel" style="padding:12px">
                  <div class="stack-sm">
                    <div class="row-between wrap">
                      <div class="row" style="gap:6px">
                        <span class={`badge ${share.format === "conf" ? "badge--green" : "badge--blue"}`}>
                          {share.format === "conf" ? "CONF" : "VPN"}
                        </span>
                        <span class="xs muted">{vm.interfaceName(share.interface_id)}</span>
                      </div>
                      <span class="xs muted row" style="gap:4px">
                        <Icon name="clock" size={12} class="" /> {t("clients.details.share.expires", { date: formatDateTimeI18n(share.expires_at) })}
                      </span>
                    </div>
                    <div class="copy-row">
                      <input class="input" type="text" readonly value={share.url} />
                      <button
                        class="btn btn--sm"
                        type="button"
                        aria-label={t("clients.details.qr.openShare")} title={t("clients.details.qr.openShare")}
                        onClick={() => vm.openShareQr(share)}
                      >
                        <Icon name="qr" size={14} class="" />
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        aria-label={t("clients.details.share.copyAria")} title={t("clients.details.share.copyAria")}
                        onClick={() => { void vm.copyText(share.url, t("clients.details.share.copyLabel")); }}
                      >
                        <Icon name="copy" size={14} class="" />
                      </button>
                      <button
                        class="btn btn--sm btn--danger"
                        type="button"
                        disabled={vm.shareBusy}
                        aria-label={t("clients.details.share.revokeAria")} title={t("clients.details.share.revokeAria")}
                        onClick={() => { void vm.revokeShare(share.token); }}
                      >
                        <Icon name="trash" size={14} class="" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
