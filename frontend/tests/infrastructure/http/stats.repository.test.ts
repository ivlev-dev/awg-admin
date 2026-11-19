import type { HttpClient } from "@/infrastructure/http/client";
import { HttpStatsRepository } from "@/infrastructure/http/stats.repository";

function makeRepository(payload: unknown): {
  repository: HttpStatsRepository;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async () => payload);
  const client = { get } as unknown as HttpClient;
  return { repository: new HttpStatsRepository(client), get };
}

describe("HttpStatsRepository: /stats/devices", () => {
  it("маппит ответ в DeviceStats и передаёт signal", async () => {
    const { repository, get } = makeRepository([
      {
        device_id: "d1",
        today: { rx: 1, tx: 2 },
        month: { rx: 3, tx: 4 },
        rx_bps: 100,
        tx_bps: 200,
      },
    ]);
    const controller = new AbortController();

    const result = await repository.deviceStats({ signal: controller.signal });

    expect(get).toHaveBeenCalledWith("/stats/devices", { signal: controller.signal });
    expect(result).toEqual([
      { device_id: "d1", today: { rx: 1, tx: 2 }, month: { rx: 3, tx: 4 } },
    ]);
  });

  it("возвращает пустой массив без лишних полей", async () => {
    const { repository } = makeRepository([]);

    await expect(repository.deviceStats()).resolves.toEqual([]);
  });
});
