import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { DefaultAuditService } from "@/application/audit/service";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { setLocale } from "@/i18n";
import { AuditPage } from "./AuditPage";
import { AuditPageVM } from "./AuditPage.vm";

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
    };
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(empty));

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

  it("помечает журнал для мобильных карточек и раскрывает детали", async () => {
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
        }),
    );

    const result = createComponent(AuditPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    const root = document.body;

    await vi.waitFor(() => {
      expect(root.querySelector("table.table--audit")).not.toBeNull();
    });

    expect(root.querySelector("table.table--audit")?.classList.contains("table--cards")).toBe(true);
    expect(root.querySelector(".table-wrap--cards")).not.toBeNull();
    expect(root.querySelector("td.cell-details[data-label='Детали']")).not.toBeNull();
    expect(root.querySelectorAll(".cell-entity")).toHaveLength(2);

    const toggle = root.querySelector(".audit-details");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector(".audit-details__text--clamped")).not.toBeNull();

    (toggle as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(root.querySelector(".audit-details")?.getAttribute("aria-expanded")).toBe("true");
    });
    expect(root.querySelector(".audit-details__text--clamped")).toBeNull();

    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });

  it("монтируется через createComponent с внедрённым сервисом", async () => {
    const auditRepository = repository();
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(auditRepository));

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
});
