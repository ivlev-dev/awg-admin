import type { ClientDetailsVM } from "../ClientDetails.vm";
import { t } from "@/i18n";

export function ClientStats(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <div class="grid grid--4 client-section" id="client-stats" tabindex={-1}>
      <div class="stat">
        <div class="stat__label"><span class="dot dot--green"></span>{t("clients.details.stats.rxToday")}</div>
        <div class="stat__value">{vm.todayRx}</div>
        <div class="stat__hint">{t("clients.details.stats.monthHint", { value: vm.monthRx })}</div>
      </div>
      <div class="stat">
        <div class="stat__label"><span class="dot" style="background:var(--brand-3)"></span>{t("clients.details.stats.txToday")}</div>
        <div class="stat__value">{vm.todayTx}</div>
        <div class="stat__hint">{t("clients.details.stats.monthHint", { value: vm.monthTx })}</div>
      </div>
      <div class="stat">
        <div class="stat__label">{t("clients.details.stats.rxMonth")}</div>
        <div class="stat__value">{vm.monthRx}</div>
        <div class="stat__hint">{t("clients.details.stats.todayHint", { value: vm.todayRx })}</div>
      </div>
      <div class="stat">
        <div class="stat__label">{t("clients.details.stats.txMonth")}</div>
        <div class="stat__value">{vm.monthTx}</div>
        <div class="stat__hint">{t("clients.details.stats.todayHint", { value: vm.todayTx })}</div>
      </div>
    </div>
  );
}
