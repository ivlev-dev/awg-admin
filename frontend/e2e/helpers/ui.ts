import { expect, type Page } from "@playwright/test";

import type { AuthView } from "./api";

export async function loginViaUi(page: Page, login: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(login);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

export async function loginAndWait(page: Page, login: string, password: string): Promise<void> {
  await loginViaUi(page, login, password);
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.locator(".topbar__title")).toHaveText("Обзор");
}

export async function seedSession(page: Page, auth: AuthView): Promise<void> {
  await page.addInitScript(
    (tokens: { access: string; refresh: string }) => {
      window.localStorage.setItem("awg.access", tokens.access);
      window.localStorage.setItem("awg.refresh", tokens.refresh);
    },
    { access: auth.token, refresh: auth.refresh_token },
  );
}

export function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}
