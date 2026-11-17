import { locale, t } from "./index";
import type { TranslationKey } from "./ru";

const UNIT_KEYS = [
  "units.b",
  "units.kb",
  "units.mb",
  "units.gb",
  "units.tb",
  "units.pb",
] as const;

export function formatBytesI18n(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  let index = 0;
  let size = safe;
  while (size >= 1024 && index < UNIT_KEYS.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : digits)} ${t(UNIT_KEYS[index] ?? "units.b")}`;
}

export function formatRateI18n(kbps: number): string {
  if (!kbps || kbps <= 0) return t("common.unlimited");
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} ${t("units.gbps")}`;
  if (kbps >= 1_000) {
    return `${(kbps / 1_000).toFixed(kbps % 1000 === 0 ? 0 : 1)} ${t("units.mbps")}`;
  }
  return `${kbps} ${t("units.kbps")}`;
}

export function formatDateI18n(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(intlLocale());
}

export function formatDateTimeI18n(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function pluralI18n(
  count: number,
  one: TranslationKey,
  few: TranslationKey,
  many: TranslationKey,
): string {
  if (locale() === "en") return t(count === 1 ? one : many);
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return t(one);
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t(few);
  return t(many);
}

function intlLocale(): string {
  return locale() === "en" ? "en-US" : "ru-RU";
}
