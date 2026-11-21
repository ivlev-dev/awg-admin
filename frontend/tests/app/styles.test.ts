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

    expect(css).toMatch(/\.sort-indicator\s*\{[^}]*color:\s*var\(--muted-2-ink\)/s);
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

describe("Тач-таргеты", () => {
  it("держит иконочные кнопки не меньше 44 px", () => {
    const base = read("../../src/styles/base.css");
    const m3 = read("../../src/styles/m3.css");
    const tables = read("../../src/styles/tables.css");

    expect(base).toMatch(/\.btn--icon\s*\{[^}]*width:\s*44px/s);
    expect(base).toMatch(/\.btn--icon\s*\{[^}]*height:\s*44px/s);
    expect(m3).toMatch(/\.btn--icon\s*\{[^}]*width:\s*44px/s);
    expect(tables).toMatch(/\.table--cards \.btn\s*\{[^}]*min-height:\s*44px/s);
    expect(tables).toMatch(/\.table--cards \.btn--icon\s*\{[^}]*width:\s*44px/s);
  });

  it("расширяет зону нажатия кнопки закрытия тоста", () => {
    const css = read("../../src/styles/components.css");

    expect(css).toMatch(/\.toast__close\s*\{[^}]*width:\s*44px/s);
    expect(css).toMatch(/\.toast__close\s*\{[^}]*height:\s*44px/s);
  });

  it("расширяет зону нажатия чекбоксов в таблицах, не увеличивая сам чекбокс", () => {
    const tables = read("../../src/styles/tables.css");
    const components = read("../../src/styles/components.css");

    expect(tables).toMatch(/\.cell-select input\[type="checkbox"\]\s*\{[^}]*padding:\s*13px/s);
    expect(tables).toMatch(/\.cell-select input\[type="checkbox"\]\s*\{[^}]*width:\s*18px|\.cell-select input\s*\{[^}]*width:\s*18px/s);
    expect(components).toMatch(/\.matrix-table input\[type="checkbox"\]\s*\{[^}]*padding:\s*13px/s);
  });
});
