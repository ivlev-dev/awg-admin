import { t } from "@/i18n";
import { formatBytesI18n } from "@/i18n/format";

export function formatRateBps(value: number | null | undefined): string {
  const bytes = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  return t("stats.rate.perSecond", { value: formatBytesI18n(bytes) });
}
