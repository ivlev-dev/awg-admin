import type { StatsRepository, StatsQueryOptions } from "@/domain/stats/repository";
import type { DeviceStats } from "@/domain/devices/types";
import type { Overview, StatsPoint } from "@/domain/types";
import { ApiError } from "@/domain/errors";
import { ValidationError } from "../errors";
import { requireText } from "../guards";

export interface StatsService {
  overview(): Promise<Overview>;
  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]>;
  deviceStats?(options?: StatsQueryOptions): Promise<DeviceStats[] | null>;
}

export class DefaultStatsService implements StatsService {
  constructor(private readonly repository: StatsRepository) {}

  overview(): Promise<Overview> {
    return this.repository.overview();
  }

  async series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    const normalizedScope = requireText(scope, "error.label.statsScope");
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new ValidationError("error.validation.statsInterval");
    }
    if (from > to) {
      throw new ValidationError("error.validation.statsRange");
    }
    return this.repository.series(normalizedScope, id, from, to);
  }

  async deviceStats(options: StatsQueryOptions = {}): Promise<DeviceStats[] | null> {
    if (this.repository.deviceStats === undefined) return null;
    try {
      return await this.repository.deviceStats(options);
    } catch (error) {
      if (error instanceof ApiError && isMissingEndpoint(error)) return null;
      throw error;
    }
  }
}

function isMissingEndpoint(error: ApiError): boolean {
  return error.status === 404 || error.status === 405 || error.status === 501;
}
