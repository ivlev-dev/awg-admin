import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { DefaultAuditService } from "@/application/audit/service";
import type { AuditRepository } from "@/domain/audit/repository";
import type { AuditEntry, AuditFilters, AuditPageResult } from "@/domain/audit/types";
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
    captured = null;
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
