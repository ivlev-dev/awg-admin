import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { DefaultAuditService } from "@/application/audit/service";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
import { setLocale } from "@/i18n";
import { AuditPage } from "@/features/audit/AuditPage";

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

function query(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

afterEach(() => {
  setLocale("ru");
});

describe("AuditPage loading state", () => {
  it("показывает skeleton и aria-busy до загрузки, затем таблицу", async () => {
    let resolveList: ((value: AuditPageResult) => void) | undefined;
    const repository: AuditRepository = {
      list: vi.fn(
        (_filters: AuditFilters): Promise<AuditPageResult> =>
          new Promise<AuditPageResult>((resolve) => {
            resolveList = resolve;
          }),
      ),
    };
    const container = createAppContainer();
    container.bind(DefaultAuditService, () => new DefaultAuditService(repository));

    const result = createComponent(AuditPage, {}, { container });
    await result.ready;

    await vi.waitFor(() => {
      expect(query(result.node, ".skeleton-table")).not.toBeNull();
    });
    expect(query(result.node, ".skeleton-table")?.getAttribute("aria-hidden")).toBe("true");
    expect(query(result.node, ".card__body[aria-busy='true']")).not.toBeNull();
    expect(query(result.node, "table.table")).toBeNull();

    if (!resolveList) throw new Error("Запрос аудита не был запущен");
    resolveList({ items: [ENTRY], next_cursor: null });

    await vi.waitFor(() => {
      expect(query(result.node, ".skeleton-table")).toBeNull();
      expect(query(result.node, "table.table")).not.toBeNull();
    });
    expect(query(result.node, ".card__body[aria-busy='false']")).not.toBeNull();
    expect(result.node.textContent).toContain("admin");

    result.dispose();
  });
});
