import type { StatsRepository } from "@/domain/stats/repository";
import type { Overview, StatsPoint } from "@/domain/types";
import type { HttpClient } from "./client";

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
}
