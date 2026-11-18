import { createComponent, flushSync } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";

import { Router } from "@/app/router";
import { Session } from "@/app/session";
import type { QuotaService, QuotaSnapshot, UserQuotaSnapshot } from "@/application/quota/service";
import type { StatsService } from "@/application/stats/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { Overview as OverviewData, StatsPoint, User } from "@/domain/types";
import { LiveStats } from "@/infrastructure/stats";
import type { TokenStore } from "@/infrastructure/storage";
import { Overview } from "@/features/overview/Overview";
import { OverviewVM } from "@/features/overview/Overview.vm";

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  email: null,
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const OVERVIEW: OverviewData = {
  today: { rx: 1024, tx: 2048 },
  month: { rx: 4096, tx: 8192 },
  rx_bps: 2048,
  tx_bps: 1024,
  nodes_online: 1,
  nodes_total: 2,
  interfaces: 2,
  groups: 1,
  devices: 3,
  users: 2,
  top_devices: [],
};

const QUOTA: QuotaSnapshot = {
  usedBytes: 1024,
  quotaBytes: 2048,
  exceeded: false,
  remainingBytes: 1024,
  percent: 50,
  periodStart: "2020-01-01T00:00:00Z",
  periodEnd: "2020-02-01T00:00:00Z",
  resetAt: "2020-02-01T00:00:00Z",
};

class MemoryTokenStore {
  access(): string | null {
    return null;
  }

  refresh(): string | null {
    return null;
  }

  set(_access: string, _refresh: string): void {
    return;
  }

  clear(): void {
    return;
  }
}

function authRepository(): AuthRepository {
  return {
    login: vi.fn(async () => {
      throw new Error("login is not used");
    }),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    refresh: vi.fn(async () => {
      throw new Error("refresh is not used");
    }),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => ADMIN),
    changePassword: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

const STATS: StatsService = {
  overview: vi.fn(async () => OVERVIEW),
  series: vi.fn(async (): Promise<StatsPoint[]> => []),
};

const QUOTA_SERVICE: QuotaService = {
  me: vi.fn(async () => QUOTA),
  users: vi.fn(async (): Promise<UserQuotaSnapshot[]> => []),
  forUser: vi.fn(async (): Promise<UserQuotaSnapshot | null> => null),
};

function makeVm(): OverviewVM {
  const session = new Session(authRepository(), new MemoryTokenStore());
  session.user = ADMIN;
  session.ready = true;
  return new OverviewVM(STATS, QUOTA_SERVICE, new LiveStats(new MemoryTokenStore()), session, new Router());
}

describe("Overview groups card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("не показывает карточку групп при выключенном флаге", async () => {
    const vm = makeVm();
    const container = new Container("overview-page-render");
    container.bindValue(OverviewVM, vm);

    const result = createComponent(Overview, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();

    const grid = document.querySelector(".grid.grid--3");
    expect(grid).not.toBeNull();
    expect(document.querySelector(".grid.grid--4")).toBeNull();

    const labels = Array.from(document.querySelectorAll(".stat__label")).map((node) => node.textContent?.trim());
    expect(labels).toContain("Ноды");
    expect(labels).toContain("Интерфейсы");
    expect(labels).toContain("Устройства");
    expect(labels).not.toContain("Группы");

    result.dispose();
  });
});
