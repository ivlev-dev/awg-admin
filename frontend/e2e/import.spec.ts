import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2EApi, uniqueSuffix, type AuthView } from "./helpers/api";
import { fieldByLabel, seedSession, selectOption } from "./helpers/ui";
import { clientConfig, generateKeyPair, serverConfig } from "./helpers/wireguard";

let api: E2EApi;
let auth: AuthView;
let nodeName: string;
let nodeId: string;

function uniqueBaseCidr(): string {
  const second = 60 + Math.floor(Math.random() * 40);
  const third = Math.floor(Math.random() * 254);
  return `10.${second}.${third}.0/24`;
}

function addressIn(cidr: string, host: number): string {
  const base = cidr.split("/")[0] ?? "10.0.0.0";
  const parts = base.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.${host}/24`;
}

function statByLabel(page: Page, label: string): Locator {
  return page
    .locator(".stat")
    .filter({ has: page.locator(".stat__label", { hasText: new RegExp(`^${label}$`) }) });
}

async function fillGroupStep(
  page: Page,
  groupName: string,
  baseCidr: string,
  node: string,
): Promise<void> {
  await page.getByLabel("Имя группы").fill(groupName);
  await page.getByLabel("base_cidr", { exact: true }).fill(baseCidr);
  await selectOption(
    page,
    page.getByRole("combobox", { name: "Нода" }),
    new RegExp(node),
  );
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByText("2. Интерфейсы")).toBeVisible();
}

test.describe("Импорт конфигурации", () => {
  test.beforeAll(async () => {
    api = await E2EApi.create();
    auth = await api.login();
    nodeName = `e2e-import-node-${uniqueSuffix()}`;
    nodeId = (await api.createNode(nodeName)).node.id;
  });

  test.afterAll(async () => {
    await api.close();
  });

  test("импорт группы с интерфейсом и клиентом", async ({ page }) => {
    const suffix = uniqueSuffix();
    const groupName = `e2e-import-${suffix}`;
    const baseCidr = uniqueBaseCidr();
    const serverKeys = generateKeyPair();
    const clientKeys = generateKeyPair();
    const clientName = `e2e-client-${suffix}`;
    const clientAddress = addressIn(baseCidr, 10);

    const serverText = serverConfig({
      privateKey: serverKeys.privateKey,
      address: addressIn(baseCidr, 1),
      listenPort: 51820,
      peers: [{ publicKey: clientKeys.publicKey, allowedIps: clientAddress }],
    });
    const clientText = clientConfig({
      privateKey: clientKeys.privateKey,
      address: clientAddress,
      serverPublicKey: serverKeys.publicKey,
    });

    await seedSession(page, auth);
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Импорт конфигурации" })).toBeVisible();
    expect(nodeId.length).toBeGreaterThan(0);

    await fillGroupStep(page, groupName, baseCidr, nodeName);

    await fieldByLabel(page, "CIDR").locator("input").fill(baseCidr);
    await page.locator("textarea").nth(0).fill(serverText);
    await fieldByLabel(page, "Endpoint host").locator("input").fill("e2e.example.com");
    await page.locator("textarea").nth(1).fill(clientText);
    await page.getByRole("button", { name: "Разобрать конфиги" }).click();

    await expect(page.getByText("1 шт.", { exact: true })).toBeVisible();
    await fieldByLabel(page, "Имя устройства").locator("input").fill(clientName);

    await page.getByRole("button", { name: "Проверить", exact: true }).click();

    await expect(page.getByText(`Группа: ${groupName}`)).toBeVisible();
    await expect(statByLabel(page, "К созданию").locator(".stat__value")).toHaveText("1");
    await expect(statByLabel(page, "Интерфейсы").locator(".stat__value")).toHaveText("1");
    await expect(page.locator("tbody tr").filter({ hasText: clientName })).toContainText("создать");

    await page.getByRole("button", { name: "Импортировать", exact: true }).click();

    await expect(page.locator(".card__title").filter({ hasText: "4. Результат" })).toBeVisible();
    await expect(statByLabel(page, "Интерфейсов").locator(".stat__value")).toHaveText("1");
    await expect(statByLabel(page, "Устройств").locator(".stat__value")).toHaveText("1");

    const group = (await api.listGroups()).find((item) => item.name === groupName);
    expect(group).toBeTruthy();
    await expect(page.getByText(`Группа: ${group?.id}`)).toBeVisible();

    const interfaces = (await api.listInterfaces()).filter(
      (item) => item.group_id === group?.id,
    );
    expect(interfaces).toHaveLength(1);
    expect(interfaces[0]?.name).toBe("awg0");

    const devices = (await api.listDevices()).filter((item) => item.group_id === group?.id);
    expect(devices.map((item) => item.name)).toContain(clientName);

    const nextClientKeys = generateKeyPair();
    const nextClientName = `e2e-client-${uniqueSuffix()}`;
    const nextClientAddress = addressIn(baseCidr, 11);
    const nextClientText = clientConfig({
      privateKey: nextClientKeys.privateKey,
      address: nextClientAddress,
      serverPublicKey: serverKeys.publicKey,
    });

    await page.getByRole("button", { name: "Устройства в интерфейс" }).click();
    await page.locator("textarea").fill(nextClientText);
    await page.getByRole("button", { name: "Разобрать конфиги" }).click();
    await fieldByLabel(page, "Имя устройства").locator("input").fill(nextClientName);

    await expect(page.getByRole("combobox", { name: "Интерфейс" })).toContainText(
      "Определить автоматически",
    );
    await page.getByRole("button", { name: "Проверить", exact: true }).click();

    await expect(page.getByText("Определён автоматически")).toBeVisible();
    const previewRow = page.locator("tbody tr").filter({ hasText: nextClientName });
    await expect(previewRow).toContainText("создать");
    await expect(previewRow).toContainText(groupName);
    await expect(previewRow).toContainText("awg0");

    await page.getByRole("button", { name: "Импортировать устройства" }).click();

    await expect(page.locator(".card__title").filter({ hasText: "Устройства импортированы" })).toBeVisible();
    await expect(statByLabel(page, "Устройств").locator(".stat__value")).toHaveText("1");

    const afterClients = (await api.listDevices()).filter(
      (item) => item.group_id === group?.id,
    );
    expect(afterClients.map((item) => item.name)).toContain(nextClientName);
    expect(afterClients).toHaveLength(2);
  });
});
