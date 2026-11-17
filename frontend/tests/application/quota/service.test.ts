import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, UserQuota } from "@/domain/quota/types";
import { DefaultQuotaService } from "@/application/quota/service";

const STATE: QuotaState = {
  used_bytes: 1024 * 1024,
  quota_bytes: 10 * 1024 * 1024,
  exceeded: false,
  remaining_bytes: 9 * 1024 * 1024,
  percent: 10,
  period_start: "2026-11-01T00:00:00Z",
  period_end: "2026-12-01T00:00:00Z",
  reset_at: "2026-12-01T00:00:00Z",
};

const USERS: UserQuota[] = [
  {
    user_id: "u1",
    login: "admin",
    used_bytes: 2 * 1024 * 1024,
    quota_bytes: 10 * 1024 * 1024,
    exceeded: false,
    percent: 20,
  },
  {
    user_id: "u2",
    login: "alice",
    used_bytes: 20 * 1024 * 1024,
    quota_bytes: 10 * 1024 * 1024,
    exceeded: true,
    percent: 200,
  },
  {
    user_id: "u3",
    login: "bob",
    used_bytes: 512,
    quota_bytes: null,
    exceeded: false,
    percent: null,
  },
];

function repository(overrides: Partial<QuotaRepository> = {}): QuotaRepository {
  return {
    me: vi.fn(async () => ({ ...STATE })),
    users: vi.fn(async () => USERS.map((quota) => ({ ...quota }))),
    ...overrides,
  };
}

describe("DefaultQuotaService", () => {
  it("нормализует свою квоту для отображения", async () => {
    const service = new DefaultQuotaService(repository());

    await expect(service.me()).resolves.toEqual({
      usedBytes: 1024 * 1024,
      quotaBytes: 10 * 1024 * 1024,
      exceeded: false,
      remainingBytes: 9 * 1024 * 1024,
      percent: 10,
      periodStart: STATE.period_start,
      periodEnd: STATE.period_end,
      resetAt: STATE.reset_at,
    });
  });

  it("возвращает null-квоту без лимита и процента", async () => {
    const service = new DefaultQuotaService(
      repository({
        me: vi.fn(async () => ({
          ...STATE,
          quota_bytes: null,
          remaining_bytes: null,
          percent: null,
          exceeded: true,
        })),
      }),
    );

    const quota = await service.me();

    expect(quota.quotaBytes).toBeNull();
    expect(quota.remainingBytes).toBeNull();
    expect(quota.percent).toBeNull();
    expect(quota.exceeded).toBe(false);
    expect(quota.usedBytes).toBe(1024 * 1024);
  });

  it("считает квоту исчерпанной при достижении лимита", async () => {
    const service = new DefaultQuotaService(
      repository({
        me: vi.fn(async () => ({
          ...STATE,
          used_bytes: 20 * 1024 * 1024,
          exceeded: false,
          percent: 200,
        })),
      }),
    );

    const quota = await service.me();

    expect(quota.exceeded).toBe(true);
    expect(quota.percent).toBe(100);
    expect(quota.remainingBytes).toBe(0);
  });

  it("ограничивает процент диапазоном 0..100 и считает его из объёмов", async () => {
    const negative = new DefaultQuotaService(
      repository({ me: vi.fn(async () => ({ ...STATE, percent: -5 })) }),
    );
    const calculated = new DefaultQuotaService(
      repository({
        me: vi.fn(async () => ({
          ...STATE,
          percent: null,
          used_bytes: 5 * 1024 * 1024,
        })),
      }),
    );

    await expect(negative.me()).resolves.toMatchObject({ percent: 0 });
    await expect(calculated.me()).resolves.toMatchObject({ percent: 50 });
  });

  it("защищает от отрицательного и нечислового использования", async () => {
    const service = new DefaultQuotaService(
      repository({
        me: vi.fn(async () => ({ ...STATE, used_bytes: Number.NaN, exceeded: false })),
      }),
    );

    const quota = await service.me();

    expect(quota.usedBytes).toBe(0);
    expect(quota.remainingBytes).toBe(10 * 1024 * 1024);
  });

  it("нормализует список квот пользователей", async () => {
    const service = new DefaultQuotaService(repository());

    const quotas = await service.users();

    expect(quotas).toHaveLength(3);
    expect(quotas[0]).toMatchObject({ userId: "u1", login: "admin", percent: 20 });
    expect(quotas[1]).toMatchObject({
      userId: "u2",
      exceeded: true,
      percent: 100,
      remainingBytes: 0,
    });
    expect(quotas[2]).toMatchObject({
      userId: "u3",
      quotaBytes: null,
      percent: null,
      remainingBytes: null,
    });
  });

  it("находит квоту пользователя по идентификатору", async () => {
    const repo = repository();
    const service = new DefaultQuotaService(repo);

    await expect(service.forUser(" u2 ")).resolves.toMatchObject({ userId: "u2", login: "alice" });
    await expect(service.forUser("missing")).resolves.toBeNull();
    await expect(service.forUser("   ")).resolves.toBeNull();
    expect(repo.users).toHaveBeenCalledTimes(2);
  });

  it("пробрасывает ошибку репозитория", async () => {
    const service = new DefaultQuotaService(
      repository({
        me: vi.fn(async () => {
          throw new Error("Сервис недоступен");
        }),
      }),
    );

    await expect(service.me()).rejects.toThrow("Сервис недоступен");
  });
});
