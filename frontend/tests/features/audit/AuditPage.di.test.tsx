import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { ToastStore } from "@/app/toast";
import { DefaultAuditService } from "@/application/audit/service";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { setLocale } from "@/i18n";
import { AuditPage } from "@/features/audit/AuditPage";
import { AuditPageVM, auditFiltersStorage } from "@/features/audit/AuditPage.vm";

const ENTRY: AuditEntry = {
  id: "e1",
  at: "2024-05-06T12:34:56Z",
  actor_id: "u1",
  actor_login: "admin",
  action: "POST",
  entity: "devices",
  entity_id: "d1",
  status: 201,
  ip: "10.0.0.1",
  details: null,
};

function repository(): AuditRepository {
  return {
    list: vi.fn(async (_filters: AuditFilters): Promise<AuditPageResult> => ({
      items: [ENTRY],
      next_cursor: null,
    })),
    clear: vi.fn(async (_filters: AuditFilters): Promise<number> => 0),
  };
}

let captured: AuditPageVM | null = null;

function AuditProbe(this: { vm: AuditPageVM }) {
  captured = this.vm;
  return <div class="audit-probe">{this.vm.total}</div>;
}

describe("AuditPageVM constructor DI", () => {
  afterEach(() => {
    setLocale("ru");
    captured = null;
  });

  it("переключает язык заголовков и пустого состояния", async () => {
    const empty: AuditRepository = {
      list: vi.fn(async (): Promise<AuditPageResult> => ({ items: [], next_cursor: null })),
      clear: vi.fn(async (): Promise<number> => 0),
    };
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(empty));
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(AuditPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Аудит");
      expect(result.node.textContent).toContain("Событий нет");
    });

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Audit");
      expect(result.node.textContent).toContain("No events");
      expect(result.node.textContent).toContain("Export CSV");
    });
    expect(result.node.textContent).not.toContain("Событий нет");

    result.dispose();
  });

  it("помечает журнал для мобильных карточек и открывает панель деталей", async () => {
    const entry: AuditEntry = {
      ...ENTRY,
      details: "policy validation failed: " + "a".repeat(200),
    };
    const container = createAppContainer();
    container.bind(
      DefaultAuditService,
      () =>
        new DefaultAuditService({
          list: vi.fn(async (): Promise<AuditPageResult> => ({ items: [entry], next_cursor: null })),
          clear: vi.fn(async (): Promise<number> => 0),
        }),
    );
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(AuditPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    const root = document.body;

    await vi.waitFor(() => {
      expect(root.querySelector("table.table--audit")).not.toBeNull();
    });

    expect(root.querySelector("table.table--audit")?.classList.contains("table--cards")).toBe(true);
    expect(root.querySelector(".data-scroll")).not.toBeNull();
    expect(root.querySelector(".data-toolbar .data-toolbar__title")?.textContent).toBe("Журнал");
    expect(root.querySelector("td.cell-details[data-label='Детали']")).not.toBeNull();
    expect(root.querySelectorAll(".cell-entity")).toHaveLength(2);

    const open = root.querySelector<HTMLButtonElement>(".audit-details-cell__open");
    expect(open).not.toBeNull();
    expect(root.querySelector(".audit-details")).toBeNull();
    expect(root.querySelector(".audit-drawer")).toBeNull();

    open?.click();

    await vi.waitFor(() => {
      expect(root.querySelector(".audit-drawer")).not.toBeNull();
    });
    const drawer = root.querySelector(".audit-drawer");
    expect(drawer?.getAttribute("role")).toBe("dialog");
    expect(drawer?.getAttribute("aria-modal")).toBe("true");
    expect(drawer?.textContent).toContain("policy validation failed");
    expect(drawer?.textContent).toContain("Событие");

    root.querySelector<HTMLButtonElement>(".audit-drawer__close")?.click();

    await vi.waitFor(() => {
      expect(root.querySelector(".audit-drawer")).toBeNull();
    });

    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });

  it("монтируется через createComponent с внедрённым сервисом", async () => {
    const auditRepository = repository();
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(auditRepository));
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(AuditProbe, {}, { container });
    await result.ready;

    expect(captured).toBeInstanceOf(AuditPageVM);
    await vi.waitFor(() => {
      const vm = captured;
      if (vm === null) throw new Error("VM не был смонтирован");
      expect(vm.total).toBe(1);
    });

    const vm = captured;
    if (vm === null) throw new Error("VM не был смонтирован");
    expect(vm.rows[0]?.statusClass).toBe("badge--green");
    expect(auditRepository.list).toHaveBeenCalledTimes(1);

    result.dispose();
  });

  it("после пустого результата при активном фильтре сброс возвращает таблицу", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
    const responses = [
      { items: [], next_cursor: null },
      { items: [ENTRY], next_cursor: null },
    ];
    const repository: AuditRepository = {
      list: vi.fn(async (): Promise<AuditPageResult> => responses.shift() ?? { items: [], next_cursor: null }),
      clear: vi.fn(async (): Promise<number> => 0),
    };
    localStorage.setItem(
      auditFiltersStorage.key,
      JSON.stringify({ action: "", entity: "", actor: "admin", status: "", from: "", to: "" }),
    );
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(repository));
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(AuditPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    const root = document.body;

    await vi.waitFor(() => {
      expect(root.querySelector(".empty")).not.toBeNull();
      expect(root.querySelector("table.table--audit")).toBeNull();
      expect(root.querySelector(".empty .btn.btn--primary.btn--sm")).not.toBeNull();
    });

    const resetButton = root.querySelector(".empty .btn.btn--primary.btn--sm") as HTMLButtonElement;
    resetButton.click();

    await vi.waitFor(() => {
      expect(root.querySelector("table.table--audit")).not.toBeNull();
    });
    expect(root.querySelector(".empty")).toBeNull();

    vi.unstubAllGlobals();
    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });
});
