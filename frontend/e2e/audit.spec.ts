import { expect, test, type Page } from "@playwright/test";

import { E2EApi, createWorkspace, uniqueSuffix, type AuthView } from "./helpers/api";
import { seedSession } from "./helpers/ui";

let api: E2EApi;
let auth: AuthView;

function auditResponse(page: Page) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/audit") && response.ok();
  });
}

test.describe("Журнал аудита", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    auth = await api.login();
    await createWorkspace(api);
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("фильтр по актору, пустая выдача и сброс", async ({ page }) => {
    await seedSession(page, auth);
    await page.goto("/audit");
    await expect(page.locator("h1").first()).toHaveText("Аудит");

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);

    const actorInput = page.getByRole("textbox", { name: "Актор" });
    await actorInput.fill("admin");
    const filtered = auditResponse(page);
    await page.getByRole("button", { name: "Применить" }).click();
    const filteredResponse = await filtered;
    expect(new URL(filteredResponse.url()).searchParams.get("actor")).toBe("admin");

    await expect(rows.first()).toBeVisible();
    const actors = await rows.locator('td[data-label="Актор"]').allInnerTexts();
    expect(actors.length).toBeGreaterThan(0);
    for (const actor of actors) {
      expect(actor.toLowerCase()).toContain("admin");
    }

    const missingActor = `no-such-actor-${uniqueSuffix()}`;
    await actorInput.fill(missingActor);
    const empty = auditResponse(page);
    await page.getByRole("button", { name: "Применить" }).click();
    const emptyResponse = await empty;
    expect(new URL(emptyResponse.url()).searchParams.get("actor")).toBe(missingActor);
    await expect(page.locator(".empty__title")).toHaveText("Событий нет");

    const reset = auditResponse(page);
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    const resetResponse = await reset;
    expect(new URL(resetResponse.url()).searchParams.get("actor")).toBeNull();

    await expect(actorInput).toHaveValue("");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });
});
