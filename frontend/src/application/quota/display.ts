import { formatPercent } from "@/domain/format";
import { t } from "@/i18n";
import { formatBytesI18n } from "@/i18n/format";

import type { QuotaUsageView } from "./service";

export interface QuotaDisplay {
  hasQuota: boolean;
  exceeded: boolean;
  usedLabel: string;
  limitLabel: string;
  remainingLabel: string;
  percentLabel: string;
  progress: number;
  progressClass: string;
  statusLabel: string;
}

export function quotaDisplay(usage: QuotaUsageView | null): QuotaDisplay {
  const percent = usage?.percent ?? null;
  const quotaBytes = usage?.quotaBytes ?? null;
  const hasQuota = quotaBytes !== null;
  const exceeded = usage?.exceeded ?? false;
  return {
    hasQuota,
    exceeded,
    usedLabel: formatBytesI18n(usage?.usedBytes ?? 0),
    limitLabel: hasQuota ? formatBytesI18n(quotaBytes ?? 0) : t("common.unlimited"),
    remainingLabel:
      usage?.remainingBytes === null || usage?.remainingBytes === undefined
        ? t("common.unlimited")
        : formatBytesI18n(usage.remainingBytes),
    percentLabel: hasQuota ? formatPercent(percent) : "—",
    progress: hasQuota ? Math.min(100, Math.max(0, percent ?? 0)) : 0,
    progressClass: !hasQuota
      ? "progress__bar"
      : exceeded
        ? "progress__bar progress__bar--danger"
        : (percent ?? 0) >= 80
          ? "progress__bar progress__bar--warn"
          : "progress__bar",
    statusLabel: exceeded
      ? t("quota.status.exceeded")
      : hasQuota
        ? t("quota.status.ok")
        : t("common.unlimited"),
  };
}
