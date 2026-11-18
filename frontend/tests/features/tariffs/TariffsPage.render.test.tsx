import { createComponent, flushSync } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";

import { ToastStore } from "@/app/toast";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { Tariff } from "@/domain/types";
import { TariffsPage } from "@/features/tariffs/TariffsPage";
import { TariffsPageVM } from "@/features/tariffs/TariffsPage.vm";
import { setLocale } from "@/i18n";

const TARIFF: Tariff = {
  id: "t1",
  name: "Basic",
  description: "Fast",
  max_devices: 3,
  device_down_kbps: 100_000,
  device_up_kbps: 50_000,
  group_down_kbps: 0,
  group_up_kbps: 0,
  traffic_quota_bytes: null,
  interface_id: null,
  interface_name: null,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

function tariffsRepository(fail = false): TariffsRepository {
  return {
    listTariffs: vi.fn(async () => {
      if (fail) throw new Error("Сеть недоступна");
      return [TARIFF];
    }),
    createTariff: vi.fn(async () => TARIFF),
    updateTariff: vi.fn(async () => TARIFF),
    deleteTariff: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function interfacesRepository(): InterfacesRepository {
  return {
    listInterfaces: vi.fn(async () => []),
    createInterface: vi.fn(async () => {
      throw new Error("not used");
    }),
    updateInterface: vi.fn(async () => {
      throw new Error("not used");
    }),
    deleteInterface: vi.fn(async () => undefined),
    rotateInterface: vi.fn(async () => {
      throw new Error("not used");
    }),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

async function render(fail = false) {
  const vm = new TariffsPageVM(
    new DefaultTariffsService(tariffsRepository(fail)),
    new DefaultInterfacesService(interfacesRepository()),
    new ToastStore(),
  );
  const container = new Container("tariffs-page-render");
  container.bindValue(TariffsPageVM, vm);
  const result = createComponent(TariffsPage, {}, { container });
  await result.ready;
  flushSync();
  document.body.appendChild(result.node);
  flushSync();
  return result;
}

beforeEach(() => {
  setLocale("ru");
});

afterEach(() => {
  setLocale("ru");
  document.body.replaceChildren();
});

describe("TariffsPage локализация и таблица", () => {
  it("в английской локали не содержит кириллицы и переводит единицы", async () => {
    setLocale("en");
    const result = await render();
    
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Basic");
    });

    expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(document.body.textContent).toContain("Mbps");
    expect(document.body.textContent).toContain("Unlimited");
    result.dispose();
  });

  it("в русской локали показывает русские единицы и «Безлимит»", async () => {
    const result = await render();
    
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Basic");
    });

    expect(document.body.textContent).toContain("Мбит/с");
    expect(document.body.textContent).toContain("Безлимит");
    result.dispose();
  });

  it("не использует фиксированную раскладку и подписывает таблицу", async () => {
    const result = await render();
    
    await vi.waitFor(() => {
      expect(document.querySelector("table.table--tariffs")).not.toBeNull();
    });

    const table = document.querySelector("table.table--tariffs");
    expect(table?.classList.contains("table--fixed")).toBe(false);
    expect(table?.getAttribute("aria-label")).toBe("Список тарифов");
    expect(table?.querySelector("th.col-tariff-name")).not.toBeNull();
    result.dispose();
  });

  it("показывает ошибку с повтором вместо пустого списка", async () => {
    const result = await render(true);
    
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Не удалось загрузить тарифы");
    });

    expect(document.body.textContent).not.toContain("Нет тарифов");
    result.dispose();
  });
});
