import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (match?.[1] === undefined) throw new Error(`селектор ${selector} не найден`);
  return match[1];
}

function token(cssBlock: string, name: string): string {
  const match = cssBlock.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  if (match?.[1] === undefined) throw new Error(`токен ${name} не найден`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("Контраст текстовых ink-токенов", () => {
  const tokens = read("../../src/styles/tokens.css");
  const light = block(tokens, ":root");
  const dark = block(tokens, "[data-theme=\"dark\"]");

  it.each([
    ["light muted-2", light, "--muted-2-ink"],
    ["light amber", light, "--amber-ink"],
    ["light green", light, "--green-ink"],
    ["dark muted-2", dark, "--muted-2-ink"],
    ["dark amber", dark, "--amber-ink"],
    ["dark green", dark, "--green-ink"],
  ])("%s ≥ 4.5:1 на surface", (_name, cssBlock, name) => {
    const surface = token(cssBlock, "--surface");
    const ink = token(cssBlock, name);
    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("применяет ink-токены в badge, status и sort indicator", () => {
    const base = read("../../src/styles/base.css");
    const shell = read("../../src/styles/shell.css");
    const tables = read("../../src/styles/tables.css");
    const m3 = read("../../src/styles/m3.css");

    expect(block(base, ".badge--green")).toMatch(/color:\s*var\(--green-ink\)/);
    expect(block(base, ".badge--amber")).toMatch(/color:\s*var\(--amber-ink\)/);
    expect(block(base, ".badge--gray")).toMatch(/color:\s*var\(--muted-2-ink\)/);
    expect(block(shell, ".status-pill")).toMatch(/color:\s*var\(--green-ink\)/);
    expect(block(shell, ".status-pill--offline")).toMatch(/color:\s*var\(--amber-ink\)/);
    expect(block(tables, ".sort-indicator")).toMatch(/color:\s*var\(--muted-2-ink\)/);
    expect(block(m3, ".status-pill")).toMatch(/color:\s*var\(--green-ink\)/);
  });
});
