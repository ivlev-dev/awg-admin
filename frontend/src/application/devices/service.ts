import type { DevicesRepository } from "../../domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
} from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireId, requireRate, requireText } from "../guards";

export class DevicesService {
  constructor(private readonly repository: DevicesRepository) {}

  listDevices(): Promise<Device[]> {
    return this.repository.listDevices();
  }

  async getDevice(id: string): Promise<Device> {
    return this.repository.getDevice(requireId(id, "Устройство"));
  }

  async createDevice(input: DeviceInput): Promise<Device> {
    return this.repository.createDevice({
      user_id: input.user_id,
      group_id: input.group_id,
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
    return this.repository.createShare(requireId(id, "Устройство"), {
      interfaceId: requireId(input.interfaceId, "Интерфейс"),
      format: input.format,
      ...(input.ttlSecs !== undefined ? { ttlSecs: input.ttlSecs } : {}),
    });
  }

  async revokeShare(token: string): Promise<void> {
    await this.repository.revokeShare(requireId(token, "Ссылка"));
  }
}
