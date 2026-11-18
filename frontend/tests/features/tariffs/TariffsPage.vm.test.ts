import { ToastStore } from "@/app/toast";
import { DefaultTariffsService } from "@/application/tariffs/service";
import type { BulkFailure, BulkResult } from "@/domain/bulk";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type { Tariff } from "@/domain/types";
import { TariffsPageVM } from "@/features/tariffs/TariffsPage.vm";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

const TARIFF: Tariff = {
  id: "t1",
  name: "Basic",
  description: "Базовый",
  max_devices: 2,
  device_down_kbps: 100,
  device_up_kbps: 50,
  group_down_kbps: 200,
  group_up_kbps: 100,
  traffic_quota_bytes: null,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const PRO: Tariff = {
  id: "t2",
  name: "Pro",
  description: "Продвинутый",
  max_devices: 5,
  device_down_kbps: 500,
  device_up_kbps: 250,
  group_down_kbps: 1000,
  group_up_kbps: 500,
  traffic_quota_bytes: 10 * 1024 * 1024 * 1024,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const PREMIUM: Tariff = {
  id: "t3",
  name: "Premium",
  description: "Максимальный",
  max_devices: 10,
  device_down_kbps: 1000,
  device_up_kbps: 500,
  group_down_kbps: 2000,
  group_up_kbps: 1000,
  traffic_quota_bytes: 50 * 1024 * 1024 * 1024,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

class MemoryTariffsRepository {
  tariffs: Tariff[];
  failure: Error | null = null;

  constructor(seed: Tariff[]) {
    this.tariffs = [...seed];
  }

  async listTariffs(): Promise<Tariff[]> {
    this.failIfNeeded();
    return [...this.tariffs];
  }

  async createTariff(input: TariffInput): Promise<Tariff> {
    this.failIfNeeded();
    const tariff: Tariff = {
      id: `t${this.tariffs.length + 1}`,
      ...input,
      created_at: "2020-01-02T00:00:00Z",
      updated_at: "2020-01-02T00:00:00Z",
    };
    this.tariffs.push(tariff);
    return tariff;
  }

  async updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    this.failIfNeeded();
    const tariff = this.tariffs.find((item) => item.id === id);
    if (tariff === undefined) throw new Error(`Тариф ${id} не найден`);
    const next: Tariff = { ...tariff, ...input };
    this.tariffs = this.tariffs.map((item) => (item.id === id ? next : item));
    return next;
  }

  async deleteTariff(id: string): Promise<void> {
    this.failIfNeeded();
    this.tariffs = this.tariffs.filter((item) => item.id !== id);
  }

  bulk = vi.fn(async (_action: "delete", ids: readonly string[]): Promise<BulkResult> => {
    this.failIfNeeded();
    const failed: BulkFailure[] = [];
    let done = 0;
    for (const id of ids) {
      if (this.tariffs.some((item) => item.id === id)) {
        this.tariffs = this.tariffs.filter((item) => item.id !== id);
        done += 1;
      } else {
        failed.push({ id, error: "Тариф не найден" });
      }
    }
    return { done, failed };
  });

  private failIfNeeded(): void {
    if (this.failure !== null) throw this.failure;
  }
}

interface SetupResult {
  vm: TariffsPageVM;
  repo: MemoryTariffsRepository;
  service: DefaultTariffsService;
  toasts: ToastStore;
}

function setup(seed: Tariff[] = [TARIFF, PRO]): SetupResult {
  const repo = new MemoryTariffsRepository(seed);
  const service = new DefaultTariffsService(repo);
  const toasts = new ToastStore();
  const vm = new TariffsPageVM(service, toasts);
  return { vm, repo, service, toasts };
}

function toastMessages(toasts: ToastStore): string[] {
  return toasts.items.map((item) => item.message);
}

beforeEach(() => {
  confirmMock.askConfirm.mockReset();
  confirmMock.askConfirm.mockResolvedValue(true);
});

describe("TariffsPageVM", () => {
  it("loads tariffs", async () => {
    const { vm } = setup();
    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.tariffs.map((tariff) => tariff.name)).toEqual(["Basic", "Pro"]);
  });

  it("reports a load error", async () => {
    const { vm, repo } = setup();
    repo.failure = new Error("Сеть недоступна");

    await vm.load();

    expect(vm.loading).toBe(false);
    expect(vm.error).toBe("Сеть недоступна");
    expect(vm.tariffs).toEqual([]);
  });

  it("creates a tariff and converts the quota to bytes", async () => {
    const { vm, repo, toasts } = setup();
    vm.openCreate();
    vm.name = "  Premium  ";
    vm.description = "  Лучший  ";
    vm.max_devices = 3;
    vm.setDeviceDownKbps(400);
    vm.setDeviceUpKbps(200);
    vm.setGroupDownKbps(800);
    vm.setGroupUpKbps(400);
    vm.quotaGb = "2";

    await vm.submit();

    expect(repo.tariffs).toHaveLength(3);
    expect(repo.tariffs[2]).toEqual(
      expect.objectContaining({
        name: "Premium",
        description: "Лучший",
        max_devices: 3,
        device_down_kbps: 400,
        device_up_kbps: 200,
        group_down_kbps: 800,
        group_up_kbps: 400,
        traffic_quota_bytes: 2 * 1024 * 1024 * 1024,
      }),
    );
    expect(vm.modalOpen).toBe(false);
    expect(vm.formError).toBeNull();
    expect(toastMessages(toasts)).toContain("Тариф создан");
  });

  it("treats an empty quota as unlimited", async () => {
    const { vm, repo } = setup();
    vm.openCreate();
    vm.name = "Unlimited";
    vm.quotaGb = "0";

    await vm.submit();

    expect(repo.tariffs[2]?.traffic_quota_bytes).toBeNull();
  });

  it("stores limits in kbps and sanitizes the input", () => {
    const { vm } = setup();
    vm.openCreate();

    vm.setDeviceDownKbps(1500);
    vm.setDeviceUpKbps(0);
    vm.setGroupDownKbps(12.6);
    vm.setGroupUpKbps(-5);

    expect(vm.device_down_kbps).toBe(1500);
    expect(vm.device_up_kbps).toBe(0);
    expect(vm.group_down_kbps).toBe(13);
    expect(vm.group_up_kbps).toBe(0);
  });

  it("rejects a tariff without a name", async () => {
    const { vm, repo, service, toasts } = setup();
    const createSpy = vi.spyOn(service, "createTariff");
    vm.openCreate();
    vm.name = "   ";

    await vm.submit();

    expect(vm.formError).toBe("Название тарифа обязательно");
    expect(createSpy).not.toHaveBeenCalled();
    expect(repo.tariffs).toHaveLength(2);
    expect(vm.modalOpen).toBe(true);
    expect(toastMessages(toasts)).toEqual([]);
  });

  it("rejects a device limit above the group limit", async () => {
    const { vm, repo } = setup();
    vm.openCreate();
    vm.name = "Broken";
    vm.setDeviceDownKbps(500);
    vm.setGroupDownKbps(100);

    await vm.submit();

    expect(vm.formError).toBe("Лимит устройства не может превышать лимит группы");
    expect(repo.tariffs).toHaveLength(2);
  });

  it("updates a tariff", async () => {
    const { vm, repo, toasts } = setup();
    vm.openEdit(PRO);

    expect(vm.title).toBe("Редактировать тариф");
    expect(vm.quotaGb).toBe("10");

    vm.name = "Pro Max";
    vm.max_devices = 10;
    await vm.submit();

    const updated = repo.tariffs.find((tariff) => tariff.id === PRO.id);
    expect(updated).toEqual(expect.objectContaining({ name: "Pro Max", max_devices: 10 }));
    expect(vm.modalOpen).toBe(false);
    expect(toastMessages(toasts)).toContain("Тариф обновлён");
  });

  it("keeps a form error when saving fails", async () => {
    const { vm, repo, toasts } = setup();
    repo.failure = new Error("Сервер недоступен");
    vm.openCreate();
    vm.name = "Premium";

    await vm.submit();

    expect(vm.formError).toBe("Сервер недоступен");
    expect(vm.saving).toBe(false);
    expect(vm.modalOpen).toBe(true);
    expect(toastMessages(toasts)).toContain("Сервер недоступен");
  });

  it("deletes a tariff after confirmation", async () => {
    const { vm, repo, toasts } = setup();

    await vm.remove(PRO.id);

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Удаление тарифа",
      message: "Удалить тариф?",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    expect(repo.tariffs.map((tariff) => tariff.id)).toEqual([TARIFF.id]);
    expect(toastMessages(toasts)).toContain("Тариф удалён");
  });

  it("cancels deletion when confirmation is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const { vm, repo, toasts } = setup();

    await vm.remove(PRO.id);

    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
    expect(repo.tariffs).toHaveLength(2);
    expect(toastMessages(toasts)).toEqual([]);
  });
});

describe("TariffsPageVM sorting", () => {
  it("sorts by name ascending by default", async () => {
    const { vm } = setup([PRO, TARIFF]);
    await vm.load();

    expect(vm.sort).toEqual({ key: "name", direction: "asc" });
    expect(vm.visible.map((tariff) => tariff.name)).toEqual(["Basic", "Pro"]);
    expect(vm.sortMark("name")).toBe("▲");
  });

  it("sorts by a numeric field and toggles the direction", async () => {
    const { vm } = setup([PRO, TARIFF]);
    await vm.load();

    vm.sortBy("max_devices");
    expect(vm.visible.map((tariff) => tariff.max_devices)).toEqual([2, 5]);
    expect(vm.sortMark("max_devices")).toBe("▲");
    expect(vm.sortMark("name")).toBe("");

    vm.sortBy("max_devices");
    expect(vm.sort).toEqual({ key: "max_devices", direction: "desc" });
    expect(vm.visible.map((tariff) => tariff.max_devices)).toEqual([5, 2]);
    expect(vm.sortMark("max_devices")).toBe("▼");
  });

  it.each([
    "max_devices",
    "device_down_kbps",
    "device_up_kbps",
    "group_down_kbps",
    "group_up_kbps",
  ] as const)("sorts by %s in both directions", async (key) => {
    const { vm } = setup([PREMIUM, TARIFF, PRO]);
    await vm.load();

    vm.sortBy(key);
    expect(vm.visible.map((tariff) => tariff.id)).toEqual([TARIFF.id, PRO.id, PREMIUM.id]);

    vm.sortBy(key);
    expect(vm.visible.map((tariff) => tariff.id)).toEqual([PREMIUM.id, PRO.id, TARIFF.id]);
  });

  it("places an unlimited quota last in ascending order", async () => {
    const { vm } = setup([TARIFF, PRO]);
    await vm.load();

    vm.sortBy("traffic_quota_bytes");
    expect(vm.visible.map((tariff) => tariff.id)).toEqual([PRO.id, TARIFF.id]);

    vm.sortBy("traffic_quota_bytes");
    expect(vm.visible.map((tariff) => tariff.id)).toEqual([TARIFF.id, PRO.id]);
  });
});

describe("TariffsPageVM search", () => {
  it("filters by name and description", async () => {
    const { vm } = setup();
    await vm.load();

    vm.search = "продв";
    expect(vm.searchActive).toBe(true);
    expect(vm.visible.map((tariff) => tariff.name)).toEqual(["Pro"]);
    expect(vm.foundLabel).toBe("Найдено: 1");

    vm.search = "basic";
    expect(vm.visible.map((tariff) => tariff.name)).toEqual(["Basic"]);

    vm.search = "  pro  ";
    expect(vm.visible.map((tariff) => tariff.name)).toEqual(["Pro"]);
  });

  it("updates the query from the input event", async () => {
    const { vm } = setup();
    await vm.load();

    vm.setSearch({ target: { value: "pro" } } as unknown as Event);

    expect(vm.search).toBe("pro");
    expect(vm.visible.map((tariff) => tariff.name)).toEqual(["Pro"]);
  });

  it("returns an empty list and resets the query", async () => {
    const { vm } = setup();
    await vm.load();

    vm.search = "нет такого";
    expect(vm.visible).toEqual([]);
    expect(vm.foundLabel).toBe("Найдено: 0");

    vm.resetSearch();
    expect(vm.searchActive).toBe(false);
    expect(vm.visible).toHaveLength(2);
  });

  it("keeps selection operations scoped to visible rows", async () => {
    const { vm } = setup();
    await vm.load();
    vm.search = "pro";

    vm.toggleSelectAll();

    expect(vm.selectedIds).toEqual([PRO.id]);
    expect(vm.isSelected(PRO.id)).toBe(true);
    expect(vm.isSelected(TARIFF.id)).toBe(false);
  });
});

describe("TariffsPageVM selection", () => {
  it("toggles a single row", async () => {
    const { vm } = setup();
    await vm.load();

    expect(vm.selectedCount).toBe(0);

    vm.toggleSelected(TARIFF.id);
    expect(vm.selectedCount).toBe(1);
    expect(vm.isSelected(TARIFF.id)).toBe(true);
    expect(vm.allVisibleSelected).toBe(false);

    vm.toggleSelected(TARIFF.id);
    expect(vm.selectedCount).toBe(0);
    expect(vm.isSelected(TARIFF.id)).toBe(false);
  });

  it("selects and clears all visible rows", async () => {
    const { vm } = setup([TARIFF, PRO, PREMIUM]);
    await vm.load();

    vm.toggleSelectAll();
    expect(vm.selectedIds).toEqual([TARIFF.id, PREMIUM.id, PRO.id]);
    expect(vm.allVisibleSelected).toBe(true);

    vm.toggleSelectAll();
    expect(vm.selectedIds).toEqual([]);
    expect(vm.allVisibleSelected).toBe(false);

    vm.toggleSelectAll();
    vm.clearSelection();
    expect(vm.selectedIds).toEqual([]);
  });

  it("selects all rows in the current sort order", async () => {
    const { vm } = setup([TARIFF, PRO]);
    await vm.load();
    vm.sortBy("max_devices");
    vm.sortBy("max_devices");

    vm.toggleSelectAll();

    expect(vm.selectedIds).toEqual([PRO.id, TARIFF.id]);
  });
});

describe("TariffsPageVM bulk delete", () => {
  it("deletes the selected tariffs in one request and reloads the list", async () => {
    const { vm, repo, service, toasts } = setup([TARIFF, PRO, PREMIUM]);
    await vm.load();
    const listSpy = vi.spyOn(service, "listTariffs");

    vm.toggleSelected(TARIFF.id);
    vm.toggleSelected(PRO.id);
    await vm.bulkDelete();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Удаление тарифов",
      message: "Удалить выбранные записи (2)?",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    expect(repo.bulk).toHaveBeenCalledTimes(1);
    expect(repo.bulk).toHaveBeenCalledWith("delete", [TARIFF.id, PRO.id]);
    expect(repo.tariffs.map((tariff) => tariff.id)).toEqual([PREMIUM.id]);
    expect(vm.tariffs.map((tariff) => tariff.id)).toEqual([PREMIUM.id]);
    expect(vm.selectedIds).toEqual([]);
    expect(vm.bulkBusy).toBe(false);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(toasts.items.at(-1)?.kind).toBe("success");
    expect(toastMessages(toasts)).toContain("Готово: 2, ошибок: 0");
  });

  it("reports a partial failure, keeps the failed tariff and clears the selection", async () => {
    const { vm, repo, toasts } = setup([TARIFF, PRO, PREMIUM]);
    await vm.load();
    repo.bulk.mockImplementationOnce(async (_action, ids): Promise<BulkResult> => {
      const failed: BulkFailure[] = [];
      let done = 0;
      for (const id of ids) {
        if (id === PRO.id) {
          failed.push({ id, error: "Сервер отклонил запрос" });
        } else {
          repo.tariffs = repo.tariffs.filter((item) => item.id !== id);
          done += 1;
        }
      }
      return { done, failed };
    });

    vm.toggleSelectAll();
    await vm.bulkDelete();

    expect(repo.bulk).toHaveBeenCalledTimes(1);
    expect(repo.bulk).toHaveBeenCalledWith("delete", [TARIFF.id, PRO.id, PREMIUM.id]);
    expect(vm.tariffs.map((tariff) => tariff.id)).toEqual([PRO.id]);
    expect(vm.selectedIds).toEqual([]);
    expect(vm.bulkBusy).toBe(false);
    expect(toastMessages(toasts)).toContain("Готово: 2, ошибок: 1");
    expect(toasts.items.at(-1)?.kind).toBe("error");
  });

  it("does nothing without a selection", async () => {
    const { vm, repo } = setup();
    await vm.load();

    await vm.bulkDelete();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(repo.bulk).not.toHaveBeenCalled();
  });

  it("keeps the selection when the confirmation is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const { vm, repo } = setup();
    await vm.load();
    vm.toggleSelected(PRO.id);

    await vm.bulkDelete();

    expect(repo.bulk).not.toHaveBeenCalled();
    expect(repo.tariffs).toHaveLength(2);
    expect(vm.selectedIds).toEqual([PRO.id]);
  });
});

describe("TariffsPageVM discard guard", () => {
  it.each<[string, (vm: TariffsPageVM) => void]>([
    ["name", (vm) => { vm.name = "Другой"; }],
    ["description", (vm) => { vm.description = "Другое"; }],
    ["max_devices", (vm) => { vm.max_devices = 7; }],
    ["device_down_kbps", (vm) => { vm.setDeviceDownKbps(300); }],
    ["device_up_kbps", (vm) => { vm.setDeviceUpKbps(150); }],
    ["group_down_kbps", (vm) => { vm.setGroupDownKbps(600); }],
    ["group_up_kbps", (vm) => { vm.setGroupUpKbps(300); }],
    ["quotaGb", (vm) => { vm.quotaGb = "5"; }],
  ])("tracks changes of %s", (_field, mutate) => {
    const { vm } = setup();
    vm.openCreate();
    expect(vm.formDirty).toBe(false);

    mutate(vm);

    expect(vm.formDirty).toBe(true);
  });

  it("detects changes in the edit form", () => {
    const { vm } = setup();
    vm.openEdit(PRO);
    expect(vm.formDirty).toBe(false);

    vm.name = "Pro Max";

    expect(vm.formDirty).toBe(true);
  });

  it("asks for confirmation and closes the modal when the form changed", async () => {
    const { vm } = setup();
    vm.openCreate();
    vm.name = "Новый тариф";

    await vm.closeModal();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith({
      title: "Отменить изменения?",
      message: "Введённые данные не сохранятся.",
      confirmLabel: "Не сохранять",
      tone: "danger",
    });
    expect(vm.modalOpen).toBe(false);
  });

  it("keeps the modal open when the discard is declined", async () => {
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    const { vm } = setup();
    vm.openCreate();
    vm.name = "Новый тариф";

    await vm.closeModal();

    expect(vm.modalOpen).toBe(true);
    expect(vm.formDirty).toBe(true);
    expect(vm.name).toBe("Новый тариф");
  });

  it("closes without confirmation when the form is untouched", async () => {
    const { vm } = setup();
    vm.openCreate();

    await vm.closeModal();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(vm.modalOpen).toBe(false);
  });

  it("does not close while saving", async () => {
    const { vm } = setup();
    vm.openCreate();
    vm.name = "Новый тариф";
    vm.saving = true;

    await vm.closeModal();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(vm.modalOpen).toBe(true);
  });

  it("resets the dirty flag after a successful save", async () => {
    const { vm } = setup();
    vm.openCreate();
    vm.name = "Premium";
    vm.quotaGb = "2";

    await vm.submit();

    expect(vm.modalOpen).toBe(false);
    expect(vm.formDirty).toBe(false);

    vm.modalOpen = true;
    await vm.closeModal();

    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(vm.modalOpen).toBe(false);
  });
});
