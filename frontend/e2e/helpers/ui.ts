import { expect, type Locator, type Page } from "@playwright/test";

import type { AuthView } from "./api";

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
}

export async function loginAndWait(page: Page, email: string, password: string): Promise<void> {
  await loginViaUi(page, email, password);
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

export async function selectOption(
  page: Page,
  trigger: Locator,
  option: string | RegExp,
): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option }).click();
}

export function fieldByLabel(page: Page, label: string): Locator {
  return page
    .locator(".field")
    .filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}
