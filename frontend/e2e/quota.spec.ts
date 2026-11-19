import { expect, test } from "@playwright/test";

import { E2EApi, createWorkspace, type AuthView, type Workspace } from "./helpers/api";
import { seedSession } from "./helpers/ui";

const QUOTA_BYTES = 512 * 1024 * 1024;

let adminApi: E2EApi;
let userApi: E2EApi;
let adminAuth: AuthView;
let userAuth: AuthView;
let workspace: Workspace;

test.describe("Квота трафика", () => {
  test.beforeAll(async () => {
    adminApi = await E2EApi.create();
    adminAuth = await adminApi.login();
    workspace = await createWorkspace(adminApi, { quotaBytes: QUOTA_BYTES });
    userApi = await E2EApi.create();
    userAuth = await userApi.login(workspace.email, workspace.password);
  });

  test.afterAll(async () => {
    await adminApi.close();
    await userApi.close();
  });

  test("квота тарифа видна в профиле пользователя", async ({ page }) => {
    await seedSession(page, userAuth);
    await page.goto("/profile");

    const card = page.locator("section.card").filter({ hasText: "Квота трафика" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("0 B");
    await expect(card).toContainText("512.0 МБ");
    await expect(card).toContainText("0.0 %");
    await expect(card).toContainText("В норме");
    expect(userAuth.user.tariff_id).toBe(workspace.tariffId);
  });

  test("профиль администратора содержит блок квоты", async ({ page }) => {
    await seedSession(page, adminAuth);
    await page.goto("/profile");

    const card = page.locator("section.card").filter({ hasText: "Квота трафика" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Период:");
  });

  test("колонка квоты в списке пользователей показывает процент и статус", async ({ page }) => {
    await seedSession(page, adminAuth);
    await page.goto("/users");
    await page.getByPlaceholder("Поиск по email").fill(workspace.email);

    const row = page.locator("tbody tr").filter({ hasText: workspace.email });
    await expect(row).toHaveCount(1);

    const quotaCell = row.locator('td[data-label="Квота"]');
    await expect(quotaCell).toContainText("0.0 %");
    await expect(quotaCell).toContainText("в норме");
    await expect(quotaCell.locator("[title]")).toHaveAttribute("title", /0 B из 512\.0 МБ/);
  });
});
