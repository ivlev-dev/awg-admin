import type { DeviceStats } from "@/domain/devices/types";
import type { StatsQueryOptions, StatsRepository } from "@/domain/stats/repository";
import type { Overview, StatsPoint } from "@/domain/types";
import type { HttpClient } from "./client";

interface DeviceStatsPayload {
  device_id: string;
  today: { rx: number; tx: number };
  month: { rx: number; tx: number };
}

export class HttpStatsRepository implements StatsRepository {
  constructor(private readonly client: HttpClient) {}

  overview(): Promise<Overview> {
    return this.client.get<Overview>("/stats/overview");
  }

  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    const params = new URLSearchParams({
      scope,
      from: String(from),
      to: String(to),
    });
    if (id) params.set("id", id);
    return this.client.get<StatsPoint[]>(`/stats/series?${params.toString()}`);
  }

  async deviceStats(options: StatsQueryOptions = {}): Promise<DeviceStats[]> {
    const payload = await this.client.get<DeviceStatsPayload[]>(
      "/stats/devices",
      options.signal === undefined ? {} : { signal: options.signal },
    );
    return payload.map((item) => ({
      device_id: item.device_id,
      today: { rx: item.today.rx, tx: item.today.tx },
      month: { rx: item.month.rx, tx: item.month.tx },
    }));
  }
}
