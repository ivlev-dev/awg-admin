import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(process.cwd(), "src", "styles");

function allCss(): string {
  return readdirSync(stylesDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(stylesDir, file), "utf8"))
    .join("\n");
}

function definitions(css: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")) ?? []).length;
}

describe("слой карточек и таблиц", () => {
  const css = allCss();

  it("определяет .card один раз", () => {
    expect(definitions(css, ".card")).toBe(1);
  });

  it("определяет .card--filled один раз", () => {
    expect(definitions(css, ".card--filled")).toBe(1);
  });

  it("определяет .sort-indicator один раз", () => {
    expect(definitions(css, ".sort-indicator")).toBe(1);
  });

  it("декларирует индикатор сортировки с контрастным токеном", () => {
    const tables = readFileSync(join(stylesDir, "tables.css"), "utf8");
    expect(tables).toMatch(/\.sort-indicator\s*\{[^}]*color:\s*var\(--muted-2-ink\)/s);
    expect(tables).toMatch(/\.sort-indicator\s*\{[^}]*font-size:\s*0\.6875rem/s);
  });
});
