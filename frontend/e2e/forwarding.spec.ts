import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2EApi, createWorkspace, type AuthView, type DeviceView, type Workspace } from "./helpers/api";
import { seedSession } from "./helpers/ui";

let api: E2EApi;
let auth: AuthView;
let workspace: Workspace;
let deviceA: DeviceView;
let deviceB: DeviceView;
let deviceC: DeviceView;

function pairLocator(page: Page, left: string, right: string): Locator {
  return page
    .locator(".forwarding-pairs label.checkbox")
    .filter({ hasText: left })
    .filter({ hasText: right });
}

async function expectPairState(
  page: Page,
  left: string,
  right: string,
  state: "разрешено" | "запрещено",
): Promise<void> {
  const pair = pairLocator(page, left, right);
  await expect(pair).toHaveCount(1);
  await expect(pair).toContainText(state);
}

test.describe("Forwarding между устройствами", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    auth = await api.login();
    workspace = await createWorkspace(api);
    deviceA = await api.createDevice({
      userId: workspace.userId,
      groupId: workspace.groupId,
      name: `e2e-A-${workspace.suffix}`,
    });
    deviceB = await api.createDevice({
      userId: workspace.userId,
      groupId: workspace.groupId,
      name: `e2e-B-${workspace.suffix}`,
    });
    deviceC = await api.createDevice({
      userId: workspace.userId,
      groupId: workspace.groupId,
      name: `e2e-C-${workspace.suffix}`,
    });
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("пары A↔B и B↔C включаются, A↔C остаётся запрещённой и сохраняется после перезагрузки", async ({
    page,
  }) => {
    await seedSession(page, auth);

    let persistedPatches = 0;
    page.on("response", (response) => {
      if (
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/devices/") &&
        response.ok()
      ) {
        persistedPatches += 1;
      }
    });

    await page.goto(`/clients/${deviceB.id}`);
    await expect(page.locator("h1").first()).toHaveText(deviceB.name);
    await expect(page.getByText("Матрица forwarding")).toBeVisible();

    await expectPairState(page, deviceA.name, deviceB.name, "запрещено");
    await expectPairState(page, deviceB.name, deviceC.name, "запрещено");
    await expectPairState(page, deviceA.name, deviceC.name, "запрещено");

    await pairLocator(page, deviceA.name, deviceB.name).locator('input[type="checkbox"]').check();
    await expectPairState(page, deviceA.name, deviceB.name, "разрешено");
    await expect.poll(() => persistedPatches).toBeGreaterThanOrEqual(2);

    const patchesAfterFirstPair = persistedPatches;
    await pairLocator(page, deviceB.name, deviceC.name).locator('input[type="checkbox"]').check();
    await expectPairState(page, deviceB.name, deviceC.name, "разрешено");
    await expect.poll(() => persistedPatches).toBeGreaterThanOrEqual(patchesAfterFirstPair + 2);

    await expectPairState(page, deviceA.name, deviceC.name, "запрещено");

    await page.reload();
    await expect(page.locator("h1").first()).toHaveText(deviceB.name);
    await expect(page.getByText("Матрица forwarding")).toBeVisible();

    await expectPairState(page, deviceA.name, deviceB.name, "разрешено");
    await expectPairState(page, deviceB.name, deviceC.name, "разрешено");
    await expectPairState(page, deviceA.name, deviceC.name, "запрещено");

    const storedA = await api.findDeviceByName(deviceA.name);
    const storedC = await api.findDeviceByName(deviceC.name);
    expect(storedA?.forwarding.allowed_devices ?? []).toContain(deviceB.id);
    expect(storedA?.forwarding.allowed_devices ?? []).not.toContain(deviceC.id);
    expect(storedC?.forwarding.allowed_devices ?? []).toContain(deviceB.id);
    expect(storedC?.forwarding.allowed_devices ?? []).not.toContain(deviceA.id);
  });
});
