import { DefaultAuditService } from "@/application/audit/service";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { formatDateTimeI18n } from "@/i18n/format";
import { formatAuditRow, AuditPageVM, auditFiltersStorage } from "./AuditPage.vm";

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

class FakeAuditRepository implements AuditRepository {
  readonly calls: AuditFilters[] = [];
  readonly pages: AuditPageResult[] = [];
  failure: Error | null = null;

  async list(filters: AuditFilters): Promise<AuditPageResult> {
    this.calls.push({ ...filters });
    if (this.failure) throw this.failure;
    return this.pages.shift() ?? { items: [], next_cursor: null };
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
  return new AuditPageVM(new DefaultAuditService(repository));
}

function unix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

describe("AuditPageVM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
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

    await vm.reset();

    expect(vm.action).toBe("");
    expect(vm.entity).toBe("");
    expect(vm.actor).toBe("");
    expect(vm.status).toBe("");
    expect(vm.from).toBe("");
    expect(vm.to).toBe("");
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

  it("разворачивает и сворачивает детали", () => {
    const vm = makeVM(new FakeAuditRepository());

    vm.toggleDetails("e1");
    expect(vm.expandedId).toBe("e1");

    vm.toggleDetails("e1");
    expect(vm.expandedId).toBeNull();
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
});
