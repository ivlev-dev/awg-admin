import { expect, test } from "@playwright/test";

import {
  DEFAULT_USER_PASSWORD,
  E2EApi,
  createUserOnly,
  type AuthView,
} from "./helpers/api";
import { generateTotp, wrongTotp } from "./helpers/totp";
import { loginViaUi, pathOf } from "./helpers/ui";

let adminApi: E2EApi;
let userApi: E2EApi;
let userAuth: AuthView;
let user: { login: string; password: string; userId: string };

test.describe("Двухфакторная аутентификация", () => {
  test.beforeAll(async () => {
    adminApi = await E2EApi.create();
    await adminApi.login();
    user = await createUserOnly(adminApi, "user");
    userApi = await E2EApi.create();
    userAuth = await userApi.login(user.login, user.password);
    expect(userAuth.user.role).toBe("user");
  });

  test.afterAll(async () => {
    await adminApi.close();
    await userApi.close();
  });

  test("включение TOTP и вход с кодом", async ({ page }) => {
    await loginViaUi(page, user.login, user.password);
    await expect(page.locator(".topbar__title")).toHaveText("Обзор");
    await page.goto("/profile");

    const totpCard = page
      .locator("section.card")
      .filter({ hasText: "Двухфакторная аутентификация" });
    await expect(totpCard).toBeVisible();
    await expect(totpCard.getByText("Отключена", { exact: true })).toBeVisible();
    await totpCard.getByRole("button", { name: "Включить" }).click();

    const dialog = page.getByRole("dialog", { name: "Включение 2FA" });
    await expect(dialog).toBeVisible();
    const secret = await dialog.locator('input[readonly]').first().inputValue();
    expect(secret.length).toBeGreaterThan(0);

    await dialog.locator("#totp-enable-code").fill(generateTotp(secret));
    await dialog.locator(".modal__foot").getByRole("button", { name: "Подтвердить" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .locator(".toast--success")
        .filter({ hasText: "Двухфакторная аутентификация включена" }),
    ).toBeVisible();
    await expect(totpCard.getByText("Включена", { exact: true })).toBeVisible();

    await page.locator(".sidebar").getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login");

    await loginViaUi(page, user.login, user.password);
    await expect(page.getByLabel("Код из приложения")).toBeVisible();

    await page.getByLabel("Код из приложения").fill(wrongTotp(secret));
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(page.locator(".alert--error")).toContainText(
      "Неверный код двухфакторной аутентификации",
    );
    expect(pathOf(page)).toBe("/login");

    await page.getByLabel("Код из приложения").fill(generateTotp(secret));
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(page.locator(".topbar__title")).toHaveText("Обзор");
    expect(pathOf(page)).toBe("/");
  });
});
