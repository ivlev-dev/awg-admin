import { expect, test } from "@playwright/test";

import { E2EApi } from "./helpers/api";
import { pathOf, seedSession } from "./helpers/ui";

interface Section {
  path: string;
  nav: string;
  title: string;
  heading: string;
}

const SECTIONS: Section[] = [
  { path: "/", nav: "Обзор", title: "Обзор", heading: "Обзор" },
  { path: "/nodes", nav: "Ноды", title: "Ноды", heading: "Ноды" },
  { path: "/interfaces", nav: "Интерфейсы", title: "Интерфейсы", heading: "Интерфейсы" },
  { path: "/groups", nav: "Группы", title: "Группы", heading: "Группы" },
  { path: "/clients", nav: "Клиенты", title: "Клиенты", heading: "Клиенты" },
  { path: "/import", nav: "Импорт", title: "Импорт", heading: "Импорт конфигурации" },
  { path: "/tariffs", nav: "Тарифы", title: "Тарифы", heading: "Тарифы" },
  { path: "/users", nav: "Пользователи", title: "Пользователи", heading: "Пользователи" },
  { path: "/audit", nav: "Аудит", title: "Аудит", heading: "Аудит" },
  { path: "/stats", nav: "Статистика", title: "Статистика", heading: "Статистика" },
  { path: "/settings", nav: "Настройки", title: "Настройки", heading: "Настройки" },
  { path: "/profile", nav: "Профиль", title: "Профиль", heading: "Профиль" },
];

let api: E2EApi;

test.describe("Навигация по разделам", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("все разделы открываются без ошибок ленивых чанков", async ({ page }) => {
    const auth = await api.login();
    await seedSession(page, auth);

    const pageErrors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.url().includes("/assets/")) {
        failedAssets.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`);
      }
    });
    page.on("response", (response) => {
      if (response.url().includes("/assets/") && response.status() >= 400) {
        failedAssets.push(`${response.url()} (HTTP ${response.status()})`);
      }
    });

    await page.goto("/");
    await expect(page.locator(".sidebar")).toBeVisible();

    for (const section of SECTIONS) {
      const navItem = page
        .locator(".sidebar .nav-item")
        .filter({ hasText: new RegExp(`^${section.nav}$`) });
      await expect(navItem).toHaveCount(1);
      await navItem.click();

      await expect(page.locator(".topbar__title")).toHaveText(section.title);
      await expect(page.locator("h1").first()).toHaveText(section.heading);
      await expect.poll(() => pathOf(page)).toBe(section.path);
      await expect(page.getByText("Не удалось загрузить раздел")).toHaveCount(0);
    }

    expect(pageErrors, `JS-ошибки: ${pageErrors.join("; ")}`).toEqual([]);
    expect(failedAssets, `Ошибки загрузки чанков: ${failedAssets.join("; ")}`).toEqual([]);
  });
});
