import { expect, test } from "@playwright/test";

import { E2EApi, uniqueSuffix, type AuthView } from "./helpers/api";
import { seedSession } from "./helpers/ui";

let api: E2EApi;
let auth: AuthView;

test.describe("Массовые действия", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    auth = await api.login();
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("тарифы удаляются одним bulk-запросом", async ({ page }) => {
    const suffix = uniqueSuffix();
    await api.createTariff({ name: `e2e-bulk-a-${suffix}`, quotaBytes: null, maxDevices: 1 });
    await api.createTariff({ name: `e2e-bulk-b-${suffix}`, quotaBytes: null, maxDevices: 1 });

    await seedSession(page, auth);
    const bulk = page.waitForResponse((response) => {
      if (response.request().method() !== "POST") return false;
      return new URL(response.url()).pathname.endsWith("/api/v1/tariffs/bulk") && response.ok();
    });

    await page.goto("/tariffs");
    await expect(page.locator("h1").first()).toHaveText("Тарифы");
    await page.getByRole("searchbox", { name: "Поиск" }).fill(suffix);

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await rows.locator('input[type="checkbox"]').first().check();
    await rows.locator('input[type="checkbox"]').nth(1).check();

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Удалить выбранные" }).click();

    const body = await (await bulk).json();
    expect(body.done).toBe(2);
    expect(body.failed).toHaveLength(0);
    await expect(rows).toHaveCount(0);
  });
});
