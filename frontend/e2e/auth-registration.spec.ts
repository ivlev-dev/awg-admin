import { expect, test } from "@playwright/test";

import {
  BASE_URL,
  DEFAULT_USER_PASSWORD,
  E2EApi,
  uniqueSuffix,
  type TariffView,
} from "./helpers/api";
import { loginViaUi, pathOf, selectOption } from "./helpers/ui";

let api: E2EApi;
let tariff: TariffView;
let sentinelEmail: string;

test.describe("Регистрация и подтверждение почты", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    await api.login();
    tariff = await api.createTariff({
      name: `e2e-register-tariff-${uniqueSuffix()}`,
      quotaBytes: null,
      maxDevices: 8,
    });
    sentinelEmail = `e2e-reg-sentinel-${uniqueSuffix()}@example.com`;
    await api.register({ email: sentinelEmail, password: DEFAULT_USER_PASSWORD });
    const sentinelMail = await api.waitForMail(sentinelEmail);
    const sentinelToken = new URL(sentinelMail.link, BASE_URL).searchParams.get("token");
    await api.verifyEmail(sentinelToken ?? "");
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("регистрация, подтверждение почты и одобрение заявки администратором", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const email = `e2e-reg-${suffix}@example.com`;
    const login = `e2e-reg-${suffix}`;
    const password = DEFAULT_USER_PASSWORD;

    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Логин (необязательно)").fill(login);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByLabel("Повторите пароль").fill(password);
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    await expect(page.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
    await expect(page.getByText(email, { exact: false })).toBeVisible();
    expect(pathOf(page)).toBe("/register");

    const mail = await api.waitForMail(email);
    expect(mail.subject).toContain("Подтверждение email");
    const token = new URL(mail.link, BASE_URL).searchParams.get("token");
    expect(token).toBeTruthy();

    const beforeVerify = await api.attemptLogin(email, password);
    expect(beforeVerify.ok).toBe(false);
    expect(beforeVerify.status).toBe(403);
    expect(beforeVerify.code).toBe("email_not_verified");

    await page.goto(`/verify-email?token=${encodeURIComponent(token ?? "")}`);
    await expect(
      page.getByText("Почта подтверждена. Ожидает подтверждения администратора."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Перейти ко входу" })).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email или логин").fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти" }).click();

    const pendingAlert = page.locator(".alert--error");
    await expect(pendingAlert).toContainText("ожидает подтверждения администратором");
    expect(pathOf(page)).toBe("/login");

    const pendingUser = (await api.listPendingUsers()).find(
      (user) => user.email === email,
    );
    expect(pendingUser).toBeTruthy();
    expect(pendingUser?.status).toBe("pending_approval");

    await loginViaUi(
      page,
      process.env.E2E_ADMIN_LOGIN ?? "admin",
      process.env.E2E_ADMIN_PASSWORD ?? "admin12345",
    );
    await expect(page.locator(".topbar__title")).toHaveText("Обзор");

    await page.goto("/users");
    await page.getByRole("button", { name: /^Заявки/ }).click();

    const pendingRow = page.locator("tbody tr").filter({ hasText: email });
    await expect(pendingRow).toHaveCount(1);
    await pendingRow.getByRole("button", { name: "Подтвердить" }).click();

    const dialog = page.getByRole("dialog", { name: "Подтвердить заявку" });
    await expect(dialog).toBeVisible();
    await selectOption(page, dialog.getByRole("combobox", { name: "Тариф" }), tariff.name);
    await dialog.locator(".modal__foot").getByRole("button", { name: "Подтвердить" }).click();

    await expect(
      page.locator(".toast--success").filter({ hasText: "Заявка подтверждена" }),
    ).toBeVisible();
    await expect(page.locator("tbody tr").filter({ hasText: email })).toHaveCount(0);
    await expect(page.locator("tbody tr").filter({ hasText: sentinelEmail })).toHaveCount(1);

    await page.locator(".sidebar").getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login");

    await loginViaUi(page, email, password);
    await expect(page.locator(".topbar__title")).toHaveText("Обзор");
    await expect(page.locator(".sidebar")).toBeVisible();
    expect(pathOf(page)).toBe("/");
  });
});
