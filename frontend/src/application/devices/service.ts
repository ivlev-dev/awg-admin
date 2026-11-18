import type { BulkResult } from "@/domain/bulk";
import type { DevicesBulkAction, DevicesRepository } from "@/domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
} from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireId, requireRate, requireText } from "../guards";

export interface DevicesService {
  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device>;
  createDevice(input: DeviceInput): Promise<Device>;
  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  listProfiles(id: string): Promise<Profile[]>;
  getProfile(id: string, interfaceId: string): Promise<Profile>;
  deviceStats(id: string): Promise<DeviceStats>;
  listShares(id: string): Promise<ShareLink[]>;
  createShare(id: string, input: CreateShareInput): Promise<ShareLink>;
  revokeShare(token: string): Promise<void>;
  revokeAllShares(id: string): Promise<number>;
  bulk(action: DevicesBulkAction, ids: readonly string[]): Promise<BulkResult>;
}

export class DefaultDevicesService implements DevicesService {
  constructor(private readonly repository: DevicesRepository) {}

  listDevices(): Promise<Device[]> {
    return this.repository.listDevices();
  }

  async getDevice(id: string): Promise<Device> {
    return this.repository.getDevice(requireId(id, "Устройство"));
  }

  async createDevice(input: DeviceInput): Promise<Device> {
    const interfaceIds = normalizeInterfaceIds(input);
    const primary = interfaceIds[0];
    return this.repository.createDevice({
      user_id: input.user_id,
      group_id: input.group_id,
      ...(primary ? { interface_id: primary } : {}),
      ...(interfaceIds.length > 0 ? { interface_ids: interfaceIds } : {}),
      name: requireText(input.name, "Имя устройства"),
      down_kbps: requireRate(input.down_kbps, "Скорость скачивания"),
      up_kbps: requireRate(input.up_kbps, "Скорость отдачи"),
      forwarding: input.forwarding,
    });
  }

  async updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    const patch: DeviceUpdateInput = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "Имя устройства");
    if (input.down_kbps !== undefined) {
      patch.down_kbps = requireRate(input.down_kbps, "Скорость скачивания");
    }
    if (input.up_kbps !== undefined) {
      patch.up_kbps = requireRate(input.up_kbps, "Скорость отдачи");
    }
    return this.repository.updateDevice(requireId(id, "Устройство"), patch);
  }

  async deleteDevice(id: string): Promise<void> {
    await this.repository.deleteDevice(requireId(id, "Устройство"));
  }

  async listProfiles(id: string): Promise<Profile[]> {
    return this.repository.listProfiles(requireId(id, "Устройство"));
  }

  async getProfile(id: string, interfaceId: string): Promise<Profile> {
    return this.repository.getProfile(
      requireId(id, "Устройство"),
      requireId(interfaceId, "Интерфейс"),
    );
  }

  async deviceStats(id: string): Promise<DeviceStats> {
    return this.repository.deviceStats(requireId(id, "Устройство"));
  }

  async listShares(id: string): Promise<ShareLink[]> {
    return this.repository.listShares(requireId(id, "Устройство"));
  }

  async createShare(id: string, input: CreateShareInput): Promise<ShareLink> {
    if (input.ttlSecs !== undefined && (!Number.isInteger(input.ttlSecs) || input.ttlSecs <= 0)) {
      throw new ValidationError("Срок жизни ссылки должен быть положительным числом секунд");
    }
    if (input.oneTime && input.maxUses !== undefined) {
      throw new ValidationError("Одноразовая ссылка не может иметь отдельный лимит использований");
    }
    const maxUses = input.maxUses;
    if (
      !input.oneTime &&
      maxUses !== undefined &&
      (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
    ) {
      throw new ValidationError("Лимит использований должен быть от 1 до 1000");
    }
    return this.repository.createShare(requireId(id, "Устройство"), {
      interfaceId: requireId(input.interfaceId, "Интерфейс"),
      format: input.format,
      ...(input.ttlSecs !== undefined ? { ttlSecs: input.ttlSecs } : {}),
      ...(input.oneTime === true ? { oneTime: true } : {}),
      ...(input.oneTime !== true && maxUses !== undefined ? { maxUses } : {}),
    });
  }

  async revokeShare(token: string): Promise<void> {
    await this.repository.revokeShare(requireId(token, "Ссылка"));
  }

  async revokeAllShares(id: string): Promise<number> {
    return this.repository.revokeAllShares(requireId(id, "Устройство"));
  }

  async bulk(action: DevicesBulkAction, ids: readonly string[]): Promise<BulkResult> {
    const normalized = ids.map((id) => requireId(id, "Устройство"));
    return this.repository.bulk(action, normalized);
  }
}

function normalizeInterfaceIds(input: DeviceInput): string[] {
  const ids: string[] = [];
  if (input.interface_id) ids.push(input.interface_id.trim());
  for (const id of input.interface_ids ?? []) ids.push(id.trim());
  return Array.from(new Set(ids.filter((id) => id.length > 0)));
}
