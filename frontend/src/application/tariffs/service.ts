import type { BulkResult } from "@/domain/bulk";
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
  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult>;
}

export class DefaultTariffsService implements TariffsService {
  constructor(private readonly repository: TariffsRepository) {}

  listTariffs(): Promise<Tariff[]> {
    return this.repository.listTariffs();
  }

  async createTariff(input: TariffInput): Promise<Tariff> {
    const normalized = normalizeTariff(input);
    const error = validateTariff(normalized);
    if (error) throw new ValidationError(error.code);
    return this.repository.createTariff(normalized);
  }

  async updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    const patch: Partial<TariffInput> = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "error.label.tariffName");
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.max_devices !== undefined) {
      if (!Number.isInteger(input.max_devices) || input.max_devices <= 0) {
        throw new ValidationError("error.validation.tariffMaxDevices");
      }
    }
    if (input.device_down_kbps !== undefined) {
      patch.device_down_kbps = requireRate(input.device_down_kbps, "error.label.deviceDownLimit");
    }
    if (input.device_up_kbps !== undefined) {
      patch.device_up_kbps = requireRate(input.device_up_kbps, "error.label.deviceUpLimit");
    }
    if (input.group_down_kbps !== undefined) {
      patch.group_down_kbps = requireRate(input.group_down_kbps, "error.label.groupDownLimit");
    }
    if (input.group_up_kbps !== undefined) {
      patch.group_up_kbps = requireRate(input.group_up_kbps, "error.label.groupUpLimit");
    }
    if (input.traffic_quota_bytes !== undefined && input.traffic_quota_bytes !== null) {
      patch.traffic_quota_bytes = requireRate(input.traffic_quota_bytes, "error.label.trafficQuota");
    }
    if (input.interface_id !== undefined) {
      patch.interface_id = normalizeInterfaceId(input.interface_id);
    }
    return this.repository.updateTariff(requireId(id, "error.label.tariff"), patch);
  }

  async deleteTariff(id: string): Promise<void> {
    await this.repository.deleteTariff(requireId(id, "error.label.tariff"));
  }

  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult> {
    const targets = ids.map((id) => requireId(id, "error.label.tariff"));
    return this.repository.bulk(action, targets);
  }
}

function normalizeTariff(input: TariffInput): TariffInput {
  return {
    name: requireText(input.name, "error.label.tariffName"),
    description: input.description.trim(),
    max_devices: Math.trunc(input.max_devices),
    device_down_kbps: requireRate(input.device_down_kbps, "error.label.deviceDownLimit"),
    device_up_kbps: requireRate(input.device_up_kbps, "error.label.deviceUpLimit"),
    group_down_kbps: requireRate(input.group_down_kbps, "error.label.groupDownLimit"),
    group_up_kbps: requireRate(input.group_up_kbps, "error.label.groupUpLimit"),
    traffic_quota_bytes:
      input.traffic_quota_bytes === null
        ? null
        : requireRate(input.traffic_quota_bytes, "error.label.trafficQuota"),
    interface_id: normalizeInterfaceId(input.interface_id),
  };
}

function normalizeInterfaceId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
