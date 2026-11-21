import { AuditPageVM } from "@/features/audit/AuditPage.vm";
import { DefaultAuditService } from "@/application/audit/service";
import { ToastStore } from "@/app/toast";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";

function entry(index: number): AuditEntry {
  return {
    id: `e${index}`,
    at: "2024-05-06T12:34:56Z",
    actor_id: "u1",
    actor_email: "admin@local",
    action: "POST",
    entity: "devices",
    entity_id: `entity-${index}`,
    status: 201,
    ip: "10.0.0.1",
    details: null,
  };
}

class PagedAuditRepository {
  readonly calls: AuditFilters[] = [];
  readonly entries: AuditEntry[];

  constructor(entries: AuditEntry[]) {
    this.entries = entries;
  }

  async list(filters: AuditFilters): Promise<AuditPageResult> {
    this.calls.push({ ...filters });
    const limit = filters.limit ?? 50;
    const before = filters.before == null ? 0 : Number(filters.before);
    const items = this.entries.slice(before, before + limit);
    const next = before + items.length;
    return {
      items,
      next_cursor: next < this.entries.length ? String(next) : null,
    };
  }

  async clear(): Promise<number> {
    return 0;
  }
}

function makeVM(repository: PagedAuditRepository): AuditPageVM {
  return new AuditPageVM(new DefaultAuditService(repository), new ToastStore());
}

describe("AuditPageVM CSV export", () => {
  it("догружает страницы и выгружает все 120 записей", async () => {
    const repository = new PagedAuditRepository(
      Array.from({ length: 120 }, (_value, index) => entry(index)),
    );
    const vm = makeVM(repository);

    const csv = await vm.buildCsv();
    const lines = csv.split("\n");

    expect(lines).toHaveLength(121);
    expect(lines[0]).toBe("at,actor,action,entity,entity_id,status,ip,details");
    expect(lines[1]).toContain("entity-0");
    expect(lines[120]).toContain("entity-119");
    expect(repository.calls).toHaveLength(3);
    expect(repository.calls.map((call) => call.before)).toEqual([undefined, "50", "100"]);
    expect(vm.exportCount).toBe(120);
  });

  it("дедуплицирует записи между страницами", async () => {
    const duplicated = Array.from({ length: 60 }, (_value, index) => entry(index % 50));
    const repository = new PagedAuditRepository(duplicated);
    const vm = makeVM(repository);

    const csv = await vm.buildCsv();

    expect(csv.split("\n")).toHaveLength(51);
    expect(vm.exportCount).toBe(50);
  });
});
