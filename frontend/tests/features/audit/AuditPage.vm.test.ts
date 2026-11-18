import { DefaultAuditService } from "@/application/audit/service";
import { ToastStore } from "@/app/toast";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { formatDateTimeI18n } from "@/i18n/format";
import { formatAuditRow, AuditPageVM, auditFiltersStorage, auditPresetsStorage } from "@/features/audit/AuditPage.vm";

const confirmMock = vi.hoisted(() => ({ askConfirm: vi.fn(async (_options: unknown) => true) }));
vi.mock("@/app/confirm", () => confirmMock);

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "e1",
    at: "2024-05-06T12:34:56Z",
    actor_id: "u1",
    actor_login: "admin",
    action: "POST",
    entity: "devices",
    entity_id: "1234567890abcdef",
    status: 201,
    ip: "10.0.0.1",
    details: null,
    ...overrides,
  };
}

class FakeAuditRepository {
  readonly calls: AuditFilters[] = [];
  readonly clearCalls: AuditFilters[] = [];
  readonly pages: AuditPageResult[] = [];
  failure: Error | null = null;
  clearFailure: Error | null = null;
  deleted = 0;

  async list(filters: AuditFilters): Promise<AuditPageResult> {
    this.calls.push({ ...filters });
    if (this.failure) throw this.failure;
    return this.pages.shift() ?? { items: [], next_cursor: null };
  }

  async clear(filters: AuditFilters): Promise<number> {
    this.clearCalls.push({ ...filters });
    if (this.clearFailure) throw this.clearFailure;
    return this.deleted;
  }
}

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

function makeVM(repository: FakeAuditRepository): AuditPageVM {
  return new AuditPageVM(new DefaultAuditService(repository), new ToastStore());
}

function setName(vm: AuditPageVM, value: string): void {
  const input = document.createElement("input");
  input.value = value;
  vm.setPresetName({ target: input } as unknown as Event);
}

function storedPresets(): unknown {
  return JSON.parse(localStorage.getItem(auditPresetsStorage.key) ?? "[]");
}

function unix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

describe("AuditPageVM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    confirmMock.askConfirm.mockClear();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("грузит первую страницу и передаёт нормализованные фильтры", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry(), entry({ id: "e2", action: "PATCH" })], next_cursor: "c1" });
    const vm = makeVM(repository);

    await vm.reload();

    expect(vm.entries).toHaveLength(2);
    expect(vm.loading).toBe(false);
    expect(vm.hasMore).toBe(true);
    expect(vm.cursor).toBe("c1");
    expect(repository.calls[0]).toEqual({
      limit: 50,
      before: undefined,
      action: undefined,
      entity: undefined,
      actor: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("дозагружает по курсору без дублей", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({
      items: [entry({ id: "a" }), entry({ id: "b" })],
      next_cursor: "c1",
    });
    repository.pages.push({
      items: [entry({ id: "b" }), entry({ id: "c" })],
      next_cursor: null,
    });
    const vm = makeVM(repository);

    await vm.reload();
    await vm.loadMore();

    expect(vm.entries.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(repository.calls[1]?.before).toBe("c1");
    expect(vm.hasMore).toBe(false);
    expect(vm.loadingMore).toBe(false);
  });

  it("не дозагружает без курсора", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: null });
    const vm = makeVM(repository);

    await vm.reload();
    await vm.loadMore();

    expect(repository.calls).toHaveLength(1);
  });

  it("смена фильтров сбрасывает курсор", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: "c1" });
    repository.pages.push({ items: [entry({ id: "e2" })], next_cursor: null });
    const vm = makeVM(repository);

    await vm.reload();
    const entityInput = document.createElement("input");
    entityInput.value = " devices ";
    vm.setAction("POST");
    vm.setStatus("500");
    vm.setEntity({ target: entityInput } as unknown as Event);
    vm.actor = " admin ";
    vm.from = "2024-01-01T10:00";
    vm.to = "2024-01-02T10:00";

    await vm.apply();

    expect(repository.calls[1]).toEqual({
      limit: 50,
      before: undefined,
      action: "POST",
      entity: "devices",
      actor: "admin",
      status: 500,
      from: unix("2024-01-01T10:00"),
      to: unix("2024-01-02T10:00"),
    });
    expect(vm.cursor).toBeNull();
  });

  it("сбрасывает фильтры и перезагружает первую страницу", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: "c1" });
    repository.pages.push({ items: [entry()], next_cursor: null });
    const vm = makeVM(repository);

    vm.action = "DELETE";
    vm.entity = "devices";
    vm.actor = "admin";
    vm.status = "404";
    vm.from = "2024-01-01T10:00";
    vm.to = "2024-01-02T10:00";
    vm.openDetails(formatAuditRow(entry()));

    await vm.reset();

    expect(vm.action).toBe("");
    expect(vm.entity).toBe("");
    expect(vm.actor).toBe("");
    expect(vm.status).toBe("");
    expect(vm.from).toBe("");
    expect(vm.to).toBe("");
    expect(vm.detailsRow).toBeNull();
    expect(repository.calls[0]?.action).toBeUndefined();
    expect(repository.calls[0]?.status).toBeUndefined();
  });

  it("восстанавливает и применяет сохранённые фильтры", async () => {
    localStorage.setItem(
      auditFiltersStorage.key,
      JSON.stringify({
        action: "POST",
        entity: "devices",
        actor: "admin",
        status: "500",
        from: "2024-01-01T10:00",
        to: "2024-01-02T10:00",
      }),
    );
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);

    expect(vm.action).toBe("POST");
    expect(vm.entity).toBe("devices");
    expect(vm.actor).toBe("admin");
    expect(vm.status).toBe("500");
    expect(vm.hasActiveFilters).toBe(true);

    await vm.reload();

    expect(repository.calls[0]).toEqual({
      limit: 50,
      before: undefined,
      action: "POST",
      entity: "devices",
      actor: "admin",
      status: 500,
      from: unix("2024-01-01T10:00"),
      to: unix("2024-01-02T10:00"),
    });
  });

  it("сохраняет фильтры при изменении и применении", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);

    vm.setAction("DELETE");
    vm.setStatus("404");
    vm.entity = "users";
    await vm.apply();

    expect(JSON.parse(localStorage.getItem(auditFiltersStorage.key) ?? "{}")).toEqual({
      action: "DELETE",
      entity: "users",
      actor: "",
      status: "404",
      from: "",
      to: "",
    });
  });

  it("очищает storage при сбросе фильтров", async () => {
    localStorage.setItem(
      auditFiltersStorage.key,
      JSON.stringify({
        action: "PATCH",
        entity: "",
        actor: "admin",
        status: "",
        from: "",
        to: "",
      }),
    );
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);
    expect(vm.action).toBe("PATCH");

    await vm.reset();

    expect(vm.action).toBe("");
    expect(vm.actor).toBe("");
    expect(vm.hasActiveFilters).toBe(false);
    expect(localStorage.getItem(auditFiltersStorage.key)).toBeNull();
  });

  it("игнорирует некорректные сохранённые фильтры", () => {
    localStorage.setItem(
      auditFiltersStorage.key,
      JSON.stringify({
        action: "GET",
        entity: "devices",
        actor: "admin",
        status: "999",
        from: "",
        to: "",
      }),
    );
    const vm = makeVM(new FakeAuditRepository());

    expect(vm.action).toBe("");
    expect(vm.entity).toBe("");
    expect(localStorage.getItem(auditFiltersStorage.key)).toBeNull();
  });

  it("не восстанавливает период с началом позже конца", () => {
    localStorage.setItem(
      auditFiltersStorage.key,
      JSON.stringify({
        action: "",
        entity: "",
        actor: "",
        status: "",
        from: "2024-02-02T10:00",
        to: "2024-02-01T10:00",
      }),
    );
    const vm = makeVM(new FakeAuditRepository());

    expect(vm.from).toBe("");
    expect(vm.to).toBe("");
  });

  it("сообщает об ошибке периода и не ходит в сеть", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);
    vm.from = "2024-02-02T10:00";
    vm.to = "2024-02-01T10:00";

    await vm.apply();

    expect(vm.error).toBe("Начало периода не может быть позже конца");
    expect(repository.calls).toHaveLength(0);
    expect(vm.loading).toBe(false);
  });

  it("показывает ошибку сети", async () => {
    const repository = new FakeAuditRepository();
    repository.failure = new Error("Сервис недоступен");
    const vm = makeVM(repository);

    await vm.reload();

    expect(vm.error).toBe("Сервис недоступен");
    expect(vm.loading).toBe(false);
    expect(vm.entries).toEqual([]);
  });

  it("показывает пустое состояние", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [], next_cursor: null });
    const vm = makeVM(repository);

    await vm.reload();

    expect(vm.isEmpty).toBe(true);
    expect(vm.hasMore).toBe(false);
    expect(vm.total).toBe(0);
  });

  it("форматирует строки и статусы", () => {
    const row = formatAuditRow(
      entry({
        entity_id: "abcdefghijklmnop",
        details: "x".repeat(130),
        status: 201,
      }),
    );

    expect(row.at).toBe(formatDateTimeI18n("2024-05-06T12:34:56Z"));
    expect(row.entityLabel).toBe("devices · abcdefgh…");
    expect(row.statusClass).toBe("badge--green");
    expect(row.hasDetails).toBe(true);
    expect(row.detailsPreview.endsWith("…")).toBe(true);
    expect(row.detailsPreview.length).toBe(121);

    expect(formatAuditRow(entry({ status: 404 })).statusClass).toBe("badge--amber");
    expect(formatAuditRow(entry({ status: 503 })).statusClass).toBe("badge--red");
    expect(formatAuditRow(entry({ status: 101 })).statusClass).toBe("badge--blue");
    expect(formatAuditRow(entry({ ip: null })).ip).toBe("—");
    expect(formatAuditRow(entry({ entity_id: null })).entityLabel).toBe("devices");
  });

  it("открывает и закрывает панель деталей", () => {
    const vm = makeVM(new FakeAuditRepository());
    const row = formatAuditRow(entry({ details: "payload" }));

    vm.openDetails(row);
    expect(vm.detailsRow).toEqual(row);

    vm.closeDetails();
    expect(vm.detailsRow).toBeNull();
  });

  it("закрывает панель деталей при обновлении журнала", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: null });
    const vm = makeVM(repository);
    await vm.reload();
    vm.openDetails(vm.rows[0] ?? formatAuditRow(entry()));
    expect(vm.detailsRow).not.toBeNull();

    await vm.refresh();

    expect(vm.detailsRow).toBeNull();
  });

  it("закрывает панель деталей при смене фильтров", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);
    vm.openDetails(formatAuditRow(entry()));
    vm.action = "POST";

    await vm.apply();

    expect(vm.detailsRow).toBeNull();
  });

  it("разрешает очистку только при активных фильтрах", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);

    expect(vm.canClear).toBe(false);

    vm.action = "POST";
    expect(vm.canClear).toBe(true);

    vm.loading = true;
    expect(vm.canClear).toBe(false);
    vm.loading = false;

    vm.clearing = true;
    expect(vm.canClear).toBe(false);
    vm.clearing = false;

    vm.action = "";
    vm.entity = "  ";
    expect(vm.canClear).toBe(false);

    vm.actor = "admin";
    expect(vm.canClear).toBe(true);
  });

  it("очищает по текущим фильтрам и обновляет журнал", async () => {
    const repository = new FakeAuditRepository();
    repository.deleted = 7;
    repository.pages.push({ items: [], next_cursor: null });
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(repository), toasts);
    vm.action = "POST";
    vm.entity = " devices ";
    vm.actor = "admin";
    vm.status = "500";
    vm.from = "2024-01-01T10:00";
    vm.to = "2024-01-02T10:00";

    await vm.clearFiltered();

    expect(confirmMock.askConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Удалить все события, подходящие под фильтр? Действие необратимо.",
      }),
    );
    expect(repository.clearCalls).toEqual([
      {
        action: "POST",
        entity: "devices",
        actor: "admin",
        status: 500,
        from: unix("2024-01-01T10:00"),
        to: unix("2024-01-02T10:00"),
      },
    ]);
    expect(repository.calls).toHaveLength(1);
    expect(vm.entries).toEqual([]);
    expect(vm.clearing).toBe(false);
    expect(vm.loading).toBe(false);
    expect(toasts.items.map((item) => item.message)).toEqual(["Удалено событий: 7"]);
  });

  it("не очищает без активных фильтров и без подтверждения", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);

    await vm.clearFiltered();
    expect(confirmMock.askConfirm).not.toHaveBeenCalled();
    expect(repository.clearCalls).toHaveLength(0);

    vm.action = "POST";
    confirmMock.askConfirm.mockResolvedValueOnce(false);
    await vm.clearFiltered();

    expect(confirmMock.askConfirm).toHaveBeenCalledTimes(1);
    expect(repository.clearCalls).toHaveLength(0);
  });

  it("показывает ошибку и тост при неудачной очистке", async () => {
    const repository = new FakeAuditRepository();
    repository.clearFailure = new Error("Сервис недоступен");
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(repository), toasts);
    vm.action = "POST";

    await vm.clearFiltered();

    expect(vm.error).toBe("Сервис недоступен");
    expect(vm.clearing).toBe(false);
    expect(repository.clearCalls).toHaveLength(1);
    expect(repository.calls).toHaveLength(0);
    expect(toasts.items.map((item) => item.message)).toEqual(["Сервис недоступен"]);
  });

  it("не показывает чипы без активных фильтров", () => {
    const vm = makeVM(new FakeAuditRepository());

    expect(vm.activeFilterChips).toEqual([]);
  });

  it("строит чипы только по непустым фильтрам", () => {
    const vm = makeVM(new FakeAuditRepository());
    vm.action = "DELETE";
    vm.entity = " devices ";
    vm.actor = " admin ";
    vm.status = "404";
    vm.from = "2024-01-01T10:00";
    vm.to = "2024-01-02T10:00";

    expect(vm.activeFilterChips).toEqual([
      { key: "action", label: "Действие: DELETE" },
      { key: "entity", label: "Объект: devices" },
      { key: "actor", label: "Актор: admin" },
      { key: "status", label: "Статус: 404" },
      { key: "from", label: `С периода: ${formatDateTimeI18n("2024-01-01T10:00")}` },
      { key: "to", label: `По: ${formatDateTimeI18n("2024-01-02T10:00")}` },
    ]);

    vm.entity = "   ";
    vm.actor = "";

    expect(vm.activeFilterChips.map((chip) => chip.key)).toEqual([
      "action",
      "status",
      "from",
      "to",
    ]);
  });

  it("сбрасывает только выбранный фильтр и обновляет журнал", async () => {
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: null });
    const vm = makeVM(repository);
    vm.action = "DELETE";
    vm.entity = "devices";
    vm.actor = "admin";
    vm.status = "404";
    vm.from = "2024-01-01T10:00";
    vm.to = "2024-01-02T10:00";
    vm.openDetails(formatAuditRow(entry()));

    await vm.clearFilter("action");

    expect(vm.action).toBe("");
    expect(vm.entity).toBe("devices");
    expect(vm.actor).toBe("admin");
    expect(vm.status).toBe("404");
    expect(vm.from).toBe("2024-01-01T10:00");
    expect(vm.to).toBe("2024-01-02T10:00");
    expect(vm.detailsRow).toBeNull();
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]).toEqual({
      limit: 50,
      before: undefined,
      action: undefined,
      entity: "devices",
      actor: "admin",
      status: 404,
      from: unix("2024-01-01T10:00"),
      to: unix("2024-01-02T10:00"),
    });
    expect(JSON.parse(localStorage.getItem(auditFiltersStorage.key) ?? "{}")).toEqual({
      action: "",
      entity: "devices",
      actor: "admin",
      status: "404",
      from: "2024-01-01T10:00",
      to: "2024-01-02T10:00",
    });
  });

  it("копирует полные детали и показывает тост", async () => {
    const writeText = vi.fn(async (_value: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);
    const details = `{"payload":"${"y".repeat(200)}"}`;
    const row = formatAuditRow(entry({ details }));

    await vm.copyDetails(row);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(details);
    expect(toasts.items.map((item) => item.message)).toEqual(["Детали скопированы"]);
  });

  it("не копирует пустые детали", async () => {
    const writeText = vi.fn(async (_value: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);

    await vm.copyDetails(formatAuditRow(entry({ details: null })));
    await vm.copyDetails(formatAuditRow(entry({ details: "" })));

    expect(writeText).not.toHaveBeenCalled();
    expect(toasts.items).toEqual([]);
  });

  it("показывает error-тост при ошибке копирования", async () => {
    const writeText = vi.fn(async (_value: string) => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);

    await vm.copyDetails(formatAuditRow(entry({ details: "payload" })));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((item) => item.message)).toEqual([
      "Не удалось скопировать детали",
    ]);
    expect(toasts.items[0]?.kind).toBe("error");
  });
});

describe("AuditPageVM пресеты", () => {
  const presetFilters = {
    action: "POST",
    entity: "devices",
    actor: "admin",
    status: "500",
    from: "2024-01-01T10:00",
    to: "2024-01-02T10:00",
  };

  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    confirmMock.askConfirm.mockClear();
    confirmMock.askConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("сохраняет пресет с текущими фильтрами и пишет его в storage", () => {
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);
    vm.action = "POST";
    vm.entity = " devices ";
    vm.status = "500";
    vm.from = "2024-01-01T10:00";

    vm.openPresetForm();
    expect(vm.presetFormOpen).toBe(true);

    setName(vm, "  Ошибки  ");
    expect(vm.canSavePreset).toBe(true);

    vm.savePreset();

    expect(vm.presets).toHaveLength(1);
    expect(vm.presets[0]?.name).toBe("Ошибки");
    expect(vm.presets[0]?.id).not.toBe("");
    expect(vm.presets[0]?.filters).toEqual({
      action: "POST",
      entity: " devices ",
      actor: "",
      status: "500",
      from: "2024-01-01T10:00",
      to: "",
    });
    expect(storedPresets()).toEqual(vm.presets);
    expect(vm.presetFormOpen).toBe(false);
    expect(vm.presetName).toBe("");
    expect(toasts.items.map((item) => item.message)).toEqual(["Фильтр сохранён"]);
  });

  it("применяет пресет, подставляет фильтры и обновляет журнал", async () => {
    localStorage.setItem(
      auditPresetsStorage.key,
      JSON.stringify([{ id: "p1", name: "Ошибки", filters: presetFilters }]),
    );
    const repository = new FakeAuditRepository();
    repository.pages.push({ items: [entry()], next_cursor: null });
    const vm = makeVM(repository);

    expect(vm.presets).toHaveLength(1);

    vm.openPresetForm();
    vm.togglePresetMenu();
    await vm.applyPreset("p1");

    expect(vm.action).toBe("POST");
    expect(vm.entity).toBe("devices");
    expect(vm.actor).toBe("admin");
    expect(vm.status).toBe("500");
    expect(vm.from).toBe("2024-01-01T10:00");
    expect(vm.to).toBe("2024-01-02T10:00");
    expect(vm.presetFormOpen).toBe(false);
    expect(vm.presetMenuOpen).toBe(false);
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]).toEqual({
      limit: 50,
      before: undefined,
      action: "POST",
      entity: "devices",
      actor: "admin",
      status: 500,
      from: unix("2024-01-01T10:00"),
      to: unix("2024-01-02T10:00"),
    });
    expect(JSON.parse(localStorage.getItem(auditFiltersStorage.key) ?? "{}")).toEqual(presetFilters);
    expect(vm.activeFilterChips).toHaveLength(6);
  });

  it("не применяет несуществующий пресет", async () => {
    const repository = new FakeAuditRepository();
    const vm = makeVM(repository);

    await vm.applyPreset("missing");

    expect(repository.calls).toHaveLength(0);
    expect(vm.action).toBe("");
  });

  it("удаляет пресет и обновляет storage", () => {
    localStorage.setItem(
      auditPresetsStorage.key,
      JSON.stringify([
        { id: "p1", name: "Первый", filters: { ...presetFilters, action: "POST" } },
        { id: "p2", name: "Второй", filters: { ...presetFilters, action: "DELETE" } },
      ]),
    );
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);
    vm.togglePresetMenu();

    vm.deletePreset("p1");

    expect(vm.presets.map((preset) => preset.id)).toEqual(["p2"]);
    expect(storedPresets()).toEqual(vm.presets);
    expect(toasts.items.map((item) => item.message)).toEqual(["Пресет удалён"]);

    vm.deletePreset("missing");
    expect(vm.presets).toHaveLength(1);
    expect(toasts.items.map((item) => item.message)).toEqual(["Пресет удалён"]);
  });

  it("закрывает меню после удаления последнего пресета", () => {
    localStorage.setItem(
      auditPresetsStorage.key,
      JSON.stringify([{ id: "p1", name: "Единственный", filters: presetFilters }]),
    );
    const vm = makeVM(new FakeAuditRepository());
    vm.togglePresetMenu();
    expect(vm.presetMenuOpen).toBe(true);

    vm.deletePreset("p1");

    expect(vm.presets).toHaveLength(0);
    expect(vm.presetMenuOpen).toBe(false);
  });

  it("не сохраняет пресет без имени", () => {
    const vm = makeVM(new FakeAuditRepository());
    vm.action = "POST";
    vm.openPresetForm();

    expect(vm.canSavePreset).toBe(false);
    vm.savePreset();
    expect(vm.presets).toHaveLength(0);

    setName(vm, "   ");
    vm.savePreset();
    expect(vm.presets).toHaveLength(0);
  });

  it("не сохраняет пресет без активных фильтров", () => {
    const vm = makeVM(new FakeAuditRepository());
    vm.openPresetForm();
    setName(vm, "Пусто");

    expect(vm.canSavePreset).toBe(false);
    vm.savePreset();

    expect(vm.presets).toHaveLength(0);
    expect(vm.presetFormOpen).toBe(false);
    expect(storedPresets()).toEqual([]);
  });

  it("не сохраняет больше 10 пресетов", () => {
    const seeded = Array.from({ length: 10 }, (_item, index) => ({
      id: `p${index}`,
      name: `Пресет ${index}`,
      filters: { ...presetFilters, action: "POST" },
    }));
    localStorage.setItem(auditPresetsStorage.key, JSON.stringify(seeded));
    const toasts = new ToastStore();
    const vm = new AuditPageVM(new DefaultAuditService(new FakeAuditRepository()), toasts);
    expect(vm.presets).toHaveLength(10);
    expect(vm.canAddPreset).toBe(false);

    vm.action = "DELETE";
    vm.openPresetForm();
    setName(vm, "Одиннадцатый");
    vm.savePreset();

    expect(vm.presets).toHaveLength(10);
    expect(storedPresets()).toEqual(vm.presets);
    expect(toasts.items.map((item) => item.message)).toEqual([
      "Нельзя сохранить больше 10 пресетов",
    ]);
    expect(toasts.items[0]?.kind).toBe("error");
  });

  it("восстанавливает пресеты после пересоздания VM", () => {
    const first = makeVM(new FakeAuditRepository());
    first.action = "PATCH";
    first.entity = "users";
    first.openPresetForm();
    setName(first, "Патчи");
    first.savePreset();
    expect(first.presets).toHaveLength(1);

    const second = makeVM(new FakeAuditRepository());

    expect(second.presets).toEqual(first.presets);
    expect(second.presets[0]?.name).toBe("Патчи");
    expect(second.presets[0]?.filters.entity).toBe("users");
  });

  it("отбрасывает некорректные пресеты из storage", () => {
    localStorage.setItem(
      auditPresetsStorage.key,
      JSON.stringify([
        { id: "ok", name: "Валидный", filters: presetFilters },
        { id: "", name: "Без id", filters: presetFilters },
        { id: "no-name", name: "   ", filters: presetFilters },
        { id: "no-filters", name: "Без фильтров" },
        { id: "bad-action", name: "Плохое действие", filters: { ...presetFilters, action: "GET" } },
        null,
        "строка",
      ]),
    );
    const vm = makeVM(new FakeAuditRepository());

    expect(vm.presets.map((preset) => preset.id)).toEqual(["ok"]);
  });

  it("не трогает текущие фильтры при сохранении пресета", () => {
    const vm = makeVM(new FakeAuditRepository());
    vm.action = "POST";
    vm.entity = "devices";
    vm.openPresetForm();
    setName(vm, "Снимок");
    vm.savePreset();

    expect(vm.action).toBe("POST");
    expect(vm.entity).toBe("devices");
    expect(vm.presetFormOpen).toBe(false);
    expect(vm.presetName).toBe("");
  });
});

describe("DefaultAuditService", () => {
  it("нормализует limit в диапазон 1..500", async () => {
    const repository = new FakeAuditRepository();
    const service = new DefaultAuditService(repository);

    await service.list({ limit: 0 });
    await service.list({ limit: 10_000 });
    await service.list({ limit: 73.9 });

    expect(repository.calls.map((call) => call.limit)).toEqual([1, 500, 73]);
  });

  it("превращает пустые строки в undefined", async () => {
    const repository = new FakeAuditRepository();
    const service = new DefaultAuditService(repository);

    await service.list({
      action: "   ",
      entity: "",
      actor: "  ",
      before: " ",
      status: 99,
    });

    expect(repository.calls[0]).toMatchObject({
      action: undefined,
      entity: undefined,
      actor: undefined,
      before: undefined,
      status: undefined,
    });
  });

  it("отклоняет период с началом позже конца", async () => {
    const repository = new FakeAuditRepository();
    const service = new DefaultAuditService(repository);

    await expect(service.list({ from: 2_000, to: 1_000 })).rejects.toThrow(
      "Начало периода не может быть позже конца",
    );
    expect(repository.calls).toHaveLength(0);
  });

  it("передаёт в очистку только фильтры и возвращает количество", async () => {
    const repository = new FakeAuditRepository();
    repository.deleted = 4;
    const service = new DefaultAuditService(repository);

    const deleted = await service.clear({
      action: " POST ",
      entity: "",
      actor: null,
      status: 200,
      from: 10,
      to: 20,
      limit: 5,
      before: "cursor",
    });

    expect(deleted).toBe(4);
    expect(repository.clearCalls).toEqual([
      {
        action: "POST",
        entity: undefined,
        actor: undefined,
        status: 200,
        from: 10,
        to: 20,
      },
    ]);
  });

  it("не очищает при периоде с началом позже конца", async () => {
    const repository = new FakeAuditRepository();
    const service = new DefaultAuditService(repository);

    await expect(service.clear({ from: 2_000, to: 1_000 })).rejects.toThrow(
      "Начало периода не может быть позже конца",
    );
    expect(repository.clearCalls).toHaveLength(0);
  });
});
