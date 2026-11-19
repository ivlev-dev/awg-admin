import { Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { t } from "@/i18n";

export function ClientSubnav(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <Show when={vm.device}>
      <div class="client-subnav">
        <div class="client-subnav__meta">
          <span class="client-subnav__name">
            {vm.device?.name ?? t("clients.details.title")}
          </span>
          <span class={`badge ${vm.revoked ? "badge--red" : "badge--green"}`}>
            <span class={`dot ${vm.revoked ? "dot--red" : "dot--green"}`}></span>
            {vm.revoked ? t("clients.status.revoked") : t("clients.status.active")}
          </span>
          <span class="client-subnav__address mono">{vm.addresses[0] ?? "—"}</span>
          <Show when={vm.tunnelCount > 0}>
            <span class="badge badge--blue" title={vm.tunnelsLabel}>
              {vm.tunnelsCountLabel}
            </span>
          </Show>
        </div>
        <nav class="client-subnav__links" aria-label={t("clients.details.nav.aria")}>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-stats")}
          >
            {t("clients.details.nav.stats")}
          </button>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-overview")}
          >
            {t("clients.details.nav.overview")}
          </button>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-settings")}
          >
            {t("clients.details.nav.settings")}
          </button>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-forwarding")}
          >
            {t("clients.details.nav.forwarding")}
          </button>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-profiles")}
          >
            {t("clients.details.nav.profiles")}
          </button>
          <button
            class="client-subnav__link"
            type="button"
            onClick={() => vm.scrollToSection("client-share")}
          >
            {t("clients.details.nav.share")}
          </button>
        </nav>
      </div>
    </Show>
  );
}
