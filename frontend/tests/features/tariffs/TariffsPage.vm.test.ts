import { ToastStore } from "@/app/toast";
import { DefaultTariffsService } from "@/application/tariffs/service";
import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type { Tariff } from "@/domain/types";
import { TariffsPageVM } from "@/features/tariffs/TariffsPage.vm";

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

function stubConfirm(result: boolean): ReturnType<typeof vi.fn> {
  const confirm = vi.fn(() => result);
  vi.stubGlobal("confirm", confirm);
  return confirm;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    vm.device_down_kbps = 400;
    vm.device_up_kbps = 200;
    vm.group_down_kbps = 800;
    vm.group_up_kbps = 400;
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
    vm.device_down_kbps = 500;
    vm.group_down_kbps = 100;

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
    const confirm = stubConfirm(true);
    const { vm, repo, toasts } = setup();

    await vm.remove(PRO.id);

    expect(confirm).toHaveBeenCalledWith("Удалить тариф?");
    expect(repo.tariffs.map((tariff) => tariff.id)).toEqual([TARIFF.id]);
    expect(toastMessages(toasts)).toContain("Тариф удалён");
  });

  it("cancels deletion when confirmation is declined", async () => {
    stubConfirm(false);
    const { vm, repo } = setup();

    await vm.remove(PRO.id);

    expect(repo.tariffs).toHaveLength(2);
  });
});
