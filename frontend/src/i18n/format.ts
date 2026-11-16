import { locale, t } from "./index";

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

function intlLocale(): string {
  return locale() === "en" ? "en-US" : "ru-RU";
}
