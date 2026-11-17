import { locale, t } from "@/i18n";
import { formatBytesI18n, formatDateTimeI18n } from "@/i18n/format";

const RELATIVE_FORMATTERS: Record<string, Intl.RelativeTimeFormat> = {};

export function formatCpuLoad(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return t("nodes.metrics.unavailable");
  }
  return value.toFixed(2);
}

export function formatNodeMemory(
  used: number | null | undefined,
  total: number | null | undefined,
): string {
  if (
    used === null ||
    used === undefined ||
    total === null ||
    total === undefined ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    used < 0 ||
    total <= 0
  ) {
    return t("nodes.metrics.unavailable");
  }
  return `${formatBytesI18n(used)} / ${formatBytesI18n(total)}`;
}

export function formatNodeMemoryPercent(
  used: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (
    used === null ||
    used === undefined ||
    total === null ||
    total === undefined ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return `${Math.min(100, Math.round((used / total) * 100))} %`;
}

export function formatMetricsUpdated(value: string | null | undefined): string {
  if (!value) return t("nodes.metrics.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("nodes.metrics.never");
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = relativeFormatter();
  const abs = Math.abs(seconds);
  if (abs < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return formatDateTimeI18n(value);
}

export function formatTokenIssuedAt(value: string | null | undefined): string {
  return value ? formatDateTimeI18n(value) : t("nodes.token.unknown");
}

function relativeFormatter(): Intl.RelativeTimeFormat {
  const current = locale();
  const cached = RELATIVE_FORMATTERS[current];
  if (cached) return cached;
  const formatter = new Intl.RelativeTimeFormat(current, { numeric: "auto" });
  RELATIVE_FORMATTERS[current] = formatter;
  return formatter;
}
