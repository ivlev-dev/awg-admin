import type { DeviceStats } from "@/domain/devices/types";
import type { StatsQueryOptions, StatsRepository } from "@/domain/stats/repository";
import type { Overview, StatsPoint } from "@/domain/types";
import type { HttpClient } from "./client";
import { invalidResponse, readDeviceStatsList, readStatsOverview, readStatsSeries } from "./response";

const TICKET_PATTERN = /^[0-9a-f]{64}$/i;

export class HttpStatsRepository implements StatsRepository {
  constructor(private readonly client: HttpClient) {}

  overview(): Promise<Overview> {
    return this.client.get<unknown>("/stats/overview").then(readStatsOverview);
  }

  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    const params = new URLSearchParams({
      scope,
      from: String(from),
      to: String(to),
    });
    if (id) params.set("id", id);
    return this.client.get<unknown>(`/stats/series?${params.toString()}`).then(readStatsSeries);
  }

  async deviceStats(options: StatsQueryOptions = {}): Promise<DeviceStats[]> {
    const payload = await this.client.get<unknown>(
      "/stats/devices",
      options.signal === undefined ? {} : { signal: options.signal },
    );
    return readDeviceStatsList(payload).map((item) => ({
      device_id: item.device_id,
      today: { rx: item.today.rx, tx: item.today.tx },
      month: { rx: item.month.rx, tx: item.month.tx },
    }));
  }

  createWsTicket(
    scope: string,
    id: string | null,
    options: StatsQueryOptions = {},
  ): Promise<string> {
    const body: { scope: string; id?: string } = { scope };
    if (id !== null) body.id = id;
    const requestOptions =
      options.signal === undefined ? {} : { signal: options.signal };
    return this.client.post<unknown>("/ws/ticket", body, requestOptions).then(readWsTicket);
  }
}

function readWsTicket(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw invalidResponse("ws.ticket");
  }
  const ticket = Reflect.get(payload, "ticket");
  if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) {
    throw invalidResponse("ws.ticket");
  }
  return ticket;
}
