import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("Стили таблиц и доступности", () => {
  it("не фиксирует layout таблиц пользователей и тарифов", () => {
    const users = read("../../src/features/users/UsersPage.tsx");
    const tariffs = read("../../src/features/tariffs/TariffsPage.tsx");

    expect(users).not.toContain("table--fixed");
    expect(tariffs).not.toContain("table--fixed");
  });

  it("задаёт минимальную ширину ключевых колонок", () => {
    const css = read("../../src/styles/tables.css");

    expect(css).toContain(".table--users .col-user { min-width: 220px; }");
    expect(css).toContain(".table--clients .col-device");
    expect(css).toContain("min-width: 220px");
  });

  it("держит контраст и rem-размер индикатора сортировки", () => {
    const css = read("../../src/styles/tables.css");

    expect(css).toMatch(/\.sort-indicator\s*\{[^}]*color:\s*var\(--muted\)/s);
    expect(css).toMatch(/\.sort-indicator\s*\{[^}]*font-size:\s*0\.6875rem/s);
  });

  it("отключает smooth scroll при prefers-reduced-motion", () => {
    const css = read("../../src/styles/base.css");

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior:\s*auto/);
  });

  it("делает подвал модалки липким на мобильных", () => {
    const css = read("../../src/styles/base.css");

    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.modal__foot\s*\{[^}]*position:\s*sticky/s);
  });
});
