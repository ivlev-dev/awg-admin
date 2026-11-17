import type { TariffsRepository } from "@/domain/tariffs/repository";
import type { TariffInput } from "@/domain/tariffs/types";
import type { Tariff } from "@/domain/types";
import { validateTariff } from "@/domain/validation";
import { ValidationError } from "../errors";
import { requireId, requireRate, requireText } from "../guards";

export interface TariffsService {
  listTariffs(): Promise<Tariff[]>;
  createTariff(input: TariffInput): Promise<Tariff>;
  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff>;
  deleteTariff(id: string): Promise<void>;
}

export class DefaultTariffsService implements TariffsService {
  constructor(private readonly repository: TariffsRepository) {}

  listTariffs(): Promise<Tariff[]> {
    return this.repository.listTariffs();
  }

  async createTariff(input: TariffInput): Promise<Tariff> {
    const normalized = normalizeTariff(input);
    const error = validateTariff(normalized);
    if (error) throw new ValidationError(error);
    return this.repository.createTariff(normalized);
  }

  async updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    const patch: Partial<TariffInput> = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "Название тарифа");
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.max_devices !== undefined) {
      if (!Number.isInteger(input.max_devices) || input.max_devices <= 0) {
        throw new ValidationError("Тариф должен разрешать хотя бы одно устройство");
      }
    }
    if (input.device_down_kbps !== undefined) {
      patch.device_down_kbps = requireRate(input.device_down_kbps, "Лимит устройства");
    }
    if (input.device_up_kbps !== undefined) {
      patch.device_up_kbps = requireRate(input.device_up_kbps, "Лимит отдачи устройства");
    }
    if (input.group_down_kbps !== undefined) {
      patch.group_down_kbps = requireRate(input.group_down_kbps, "Лимит группы");
    }
    if (input.group_up_kbps !== undefined) {
      patch.group_up_kbps = requireRate(input.group_up_kbps, "Лимит отдачи группы");
    }
    if (input.traffic_quota_bytes !== undefined && input.traffic_quota_bytes !== null) {
      patch.traffic_quota_bytes = requireRate(input.traffic_quota_bytes, "Квота трафика");
    }
    return this.repository.updateTariff(requireId(id, "Тариф"), patch);
  }

  async deleteTariff(id: string): Promise<void> {
    await this.repository.deleteTariff(requireId(id, "Тариф"));
  }
}

function normalizeTariff(input: TariffInput): TariffInput {
  return {
    name: requireText(input.name, "Название тарифа"),
    description: input.description.trim(),
    max_devices: Math.trunc(input.max_devices),
    device_down_kbps: requireRate(input.device_down_kbps, "Лимит устройства"),
    device_up_kbps: requireRate(input.device_up_kbps, "Лимит отдачи устройства"),
    group_down_kbps: requireRate(input.group_down_kbps, "Лимит группы"),
    group_up_kbps: requireRate(input.group_up_kbps, "Лимит отдачи группы"),
    traffic_quota_bytes:
      input.traffic_quota_bytes === null
        ? null
        : requireRate(input.traffic_quota_bytes, "Квота трафика"),
  };
}
