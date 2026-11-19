export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} %`;
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

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const guarded = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
