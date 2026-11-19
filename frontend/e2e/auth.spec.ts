import { expect, test } from "@playwright/test";

import {
  ADMIN_LOGIN,
  ADMIN_PASSWORD,
  E2EApi,
  createUserOnly,
  type AuthView,
} from "./helpers/api";
import { loginAndWait, loginViaUi, pathOf } from "./helpers/ui";

let api: E2EApi;
let pairUser: { email: string; password: string; userId: string };
let login: AuthView;

test.describe("Аутентификация", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    login = await api.login();
    pairUser = await createUserOnly(api, "user");
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("успешный вход admin открывает панель", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/login");

    await loginViaUi(page, ADMIN_LOGIN, ADMIN_PASSWORD);

    await expect(page.locator(".topbar__title")).toHaveText("Обзор");
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Аудит" })).toBeVisible();
    expect(login.user.role).toBe("admin");
    expect(pathOf(page)).toBe("/");
  });

  test("неверный пароль показывает ошибку и не пускает в панель", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(ADMIN_LOGIN);
    await page.getByLabel("Пароль", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.locator(".alert--error")).toBeVisible();
    await expect(page.locator(".alert--error")).not.toHaveText("");
    expect(pathOf(page)).toBe("/login");
    await expect(page.locator(".sidebar")).toHaveCount(0);
  });

  test("выход завершает сессию и закрывает защищённые разделы", async ({ page }) => {
    await loginAndWait(page, ADMIN_LOGIN, ADMIN_PASSWORD);

    await page.locator(".sidebar").getByRole("button", { name: "Выйти", exact: true }).click();
    await page.locator(".confirm-dialog").getByRole("button", { name: "Выйти", exact: true }).click();

    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await expect(page.locator(".sidebar")).toHaveCount(0);

    await page.goto("/users");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
  });

  test("пользователь без роли admin не видит и не открывает /audit", async ({ page }) => {
    await loginAndWait(page, pairUser.email, pairUser.password);

    const auditNav = page.locator(".sidebar .nav-item").filter({ hasText: "Аудит" });
    await expect(auditNav).toHaveCount(0);
    const usersNav = page.locator(".sidebar .nav-item").filter({ hasText: "Пользователи" });
    await expect(usersNav).toHaveCount(0);

    await page.goto("/audit");

    await expect(page.locator(".topbar__title")).toHaveText("Обзор");
    expect(pathOf(page)).toBe("/");
    await expect(page.locator("h1")).toHaveText("Обзор");
  });
});
