import { Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "./ClientDetails.vm";
import { ClientAddTunnelDialog, ClientQrDialog, ClientRenameTunnelDialog } from "./details/ClientDialogs";
import { ClientForwardingSection } from "./details/ClientForwardingSection";
import { ClientOverviewSection } from "./details/ClientOverviewSection";
import { ClientProfilesSection } from "./details/ClientProfilesSection";
import { ClientSettingsSection } from "./details/ClientSettingsSection";
import { ClientShareSection } from "./details/ClientShareSection";
import { ClientStats } from "./details/ClientStats";
import { ClientSubnav } from "./details/ClientSubnav";
import { Icon } from "@/components/Icon";
import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/Skeleton";
import { t } from "@/i18n";

export function ClientDetails(this: { vm: ClientDetailsVM }) {
  const vm = this.vm;
  return (
    <div class="stack">
      <div class="page-head">
        <div class="page-head__eyebrow">{t("clients.details.eyebrow")}</div>
        <div class="row-between wrap">
          <div>
            <h1>{vm.device?.name ?? t("clients.details.title")}</h1>
            <p>{t("clients.details.subtitle")}</p>
          </div>
          <div class="actions-bar">
            <button class="btn btn--sm btn--ghost" type="button" onClick={() => vm.back()}>
              ← {t("common.back")}
            </button>
            <button class="btn btn--sm" type="button" onClick={() => vm.load()}>
              <Icon name="refresh" size={14} class="" /> {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      <ClientSubnav vm={vm} />

      <Show when={vm.error}>
        <div class="alert alert--error">{vm.error}</div>
      </Show>

      <Show
        when={!vm.loading}
        fallback={
          <div class="stack">
            <Skeleton height={28} width="55%" />
            <SkeletonCards count={4} />
            <div class="grid grid--2">
              <Skeleton height={220} radius={16} />
              <Skeleton height={220} radius={16} />
            </div>
            <section class="card">
              <div class="card__body">
                <SkeletonTable rows={4} columns={4} />
              </div>
            </section>
          </div>
        }
      >
        <div class="stack">
          <ClientStats vm={vm} />

          <Show
            when={vm.device}
            fallback={
              <div class="empty">
                <div class="empty__title">{t("clients.details.notFound.title")}</div>
                <div class="small">{t("clients.details.notFound.text")}</div>
                <div style="margin-top:14px">
                  <button class="btn btn--sm" type="button" onClick={() => vm.back()}>
                    {t("clients.details.notFound.action")}
                  </button>
                </div>
              </div>
            }
          >
            <div class="stack">
              <div class="grid grid--2">
                <ClientOverviewSection vm={vm} />
                <ClientSettingsSection vm={vm} />
              </div>

              <ClientForwardingSection vm={vm} />
              <ClientProfilesSection vm={vm} />
              <ClientShareSection vm={vm} />
            </div>
          </Show>
        </div>
      </Show>

      <ClientQrDialog vm={vm} />
      <ClientAddTunnelDialog vm={vm} />
      <ClientRenameTunnelDialog vm={vm} />
    </div>
  );
}
