import { Match, Show, Switch, For } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { t } from "@/i18n";

export function ClientProfilesSection(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <section class="card client-section" id="client-profiles" tabindex={-1}>
      <div class="card__head">
        <div>
          <h2 class="card__title" tabindex={-1}>{t("clients.details.profiles.title")}</h2>
          <div class="card__sub">{t("clients.details.profiles.subtitle")}</div>
        </div>
      </div>
      <div class="card__body">
        <Show
          when={vm.profiles.length > 0}
          fallback={
            <div class="empty">
              <div class="empty__title">{t("clients.details.profiles.emptyTitle")}</div>
              <div class="small">{t("clients.details.profiles.emptyText")}</div>
            </div>
          }
        >
          <div class="stack">
            <div class="tabs" role="tablist" aria-label={t("clients.details.profiles.title")}>
              <For each={vm.profiles}>
                {(profile) => (
                  <button
                    class={`tab ${vm.activePeerId === profile.peer_id ? "is-active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={vm.activePeerId === profile.peer_id}
                    onClick={() => vm.selectProfile(profile.peer_id)}
                  >
                    <span>{vm.profileLabel(profile)}</span>
                    <Show when={vm.profileInterfaceHint(profile)}>
                      <span class="xs muted" style="margin-left:6px">
                        {vm.profileInterfaceHint(profile)}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>

            <Switch fallback={<div class="small muted">{t("clients.details.profiles.select")}</div>}>
              <Match when={vm.activeProfile}>
                <div class="stack-sm">
                  <div class="row-between wrap">
                    <div class="xs muted">
                      Endpoint: <span class="mono">{vm.activeProfile?.endpoint ?? "—"}</span>
                    </div>
                    <div class="actions-bar">
                      <button class="btn btn--sm" type="button" onClick={() => vm.copyProfile()}>
                        <Icon name="copy" size={14} class="" /> {t("clients.details.profiles.copy")}
                      </button>
                      <button class="btn btn--sm" type="button" onClick={() => vm.downloadProfile()}>
                        <Icon name="download" size={14} class="" /> {t("clients.details.profiles.download")}
                      </button>
                      <button class="btn btn--sm" type="button" onClick={() => vm.copyVpn()}>
                        <Icon name="link" size={14} class="" /> {t("clients.details.profiles.copyVpn")}
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        disabled={!vm.canShowConfQr}
                        aria-label={t("clients.details.qr.openConf")} title={t("clients.details.qr.openConf")}
                        onClick={() => vm.openConfQr()}
                      >
                        <Icon name="qr" size={14} class="" /> {t("clients.details.qr.buttonConf")}
                      </button>
                    </div>
                  </div>
                  <pre class="code">{vm.activeProfile?.conf ?? ""}</pre>
                </div>
              </Match>
            </Switch>
          </div>
        </Show>
      </div>
    </section>
  );
}
