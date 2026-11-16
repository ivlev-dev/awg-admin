import type { TariffsRepository } from "../../domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type { Tariff } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpTariffsRepository implements TariffsRepository {
  constructor(private readonly client: HttpClient) {}

  listTariffs(): Promise<Tariff[]> {
    return this.client.get<Tariff[]>("/tariffs");
  }

  createTariff(input: TariffInput): Promise<Tariff> {
    return this.client.post<Tariff>("/tariffs", input);
  }

  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    return this.client.patch<Tariff>(`/tariffs/${id}`, input);
  }

  async deleteTariff(id: string): Promise<void> {
    await this.client.delete(`/tariffs/${id}`);
  }
}
