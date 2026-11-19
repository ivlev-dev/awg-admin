import type { DeviceStats } from "../devices/types";
import type { Overview, StatsPoint } from "../types";

export interface StatsQueryOptions {
  signal?: AbortSignal;
}

export interface StatsRepository {
  overview(): Promise<Overview>;
  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]>;
  deviceStats?(options?: StatsQueryOptions): Promise<DeviceStats[]>;
}
