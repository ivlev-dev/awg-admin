import type { BulkResult } from "../bulk";
import type { Tariff } from "../types";
import type { TariffInput } from "./types";

export interface TariffsRepository {
  listTariffs(): Promise<Tariff[]>;
  createTariff(input: TariffInput): Promise<Tariff>;
  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff>;
  deleteTariff(id: string): Promise<void>;
  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult>;
}
