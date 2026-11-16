import type { StatsRepository } from "../../domain/stats/repository";
import type { Overview, StatsPoint } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireText } from "../guards";

export class StatsService {
  constructor(private readonly repository: StatsRepository) {}

  overview(): Promise<Overview> {
    return this.repository.overview();
  }

  async series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    const normalizedScope = requireText(scope, "Область статистики");
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new ValidationError("Некорректный интервал статистики");
    }
    if (from > to) {
      throw new ValidationError("Начало интервала не может быть позже конца");
    }
    return this.repository.series(normalizedScope, id, from, to);
  }
}
