import type { Overview, StatsPoint } from "../types";

export interface StatsRepository {
  overview(): Promise<Overview>;
  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]>;
}
