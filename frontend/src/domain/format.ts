const UNITS = ["B", "КБ", "МБ", "ГБ", "ТБ", "ПБ"];

export function formatBytes(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  let index = 0;
  let size = safe;
  while (size >= 1024 && index < UNITS.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : digits)} ${UNITS[index]}`;
}

export function formatRate(kbps: number): string {
  if (!kbps || kbps <= 0) return "Без лимита";
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Гбит/с`;
  if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(kbps % 1000 === 0 ? 0 : 1)} Мбит/с`;
  return `${kbps} Кбит/с`;
}

export function formatPerSecond(kbps: number): string {
  if (!kbps || kbps <= 0) return "0 Б/с";
  return `${formatBytes((kbps * 1000) / 8)}/с`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} %`;
}

export function formatDateRu(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU");
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long" }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "никогда";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "никогда";
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return formatDay(value);
}

export function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

const BROWSER_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Edge", /Edg(e|A|iOS)?\//],
  ["Opera", /OPR\/|Opera/],
  ["Firefox", /Firefox\/|FxiOS\//],
  ["Chrome", /Chrome\/|CriOS\//],
  ["Safari", /Safari\//],
];

const OS_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Windows", /Windows/],
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Linux", /Linux/],
];

export function userAgentLabel(value: string | null | undefined): string | null {
  const agent = value?.trim();
  if (!agent) return null;
  const browser = matchPattern(BROWSER_PATTERNS, agent);
  const os = matchPattern(OS_PATTERNS, agent);
  const parts = [browser, os].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function matchPattern(
  patterns: ReadonlyArray<readonly [string, RegExp]>,
  value: string,
): string | null {
  for (const [name, pattern] of patterns) {
    if (pattern.test(value)) return name;
  }
  return null;
}

export function percent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const guarded = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
