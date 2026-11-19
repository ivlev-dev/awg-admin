import type { BulkResult } from "@/domain/bulk";
import type { DevicesBulkAction, DevicesRepository } from "@/domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceStatsQueryOptions,
  DeviceUpdateInput,
} from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import { ValidationError } from "../errors";
import { PEER_LABEL_MAX, requireId, requirePeerLabel, requireRate, requireText } from "../guards";

export interface DevicesService {
  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device>;
  createDevice(input: DeviceInput): Promise<Device>;
  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  listProfiles(id: string): Promise<Profile[]>;
  getProfile(id: string, interfaceId: string): Promise<Profile>;
  profileByPeer(id: string, peerId: string): Promise<Profile>;
  addTunnel(id: string, interfaceId: string, label?: string): Promise<Device>;
  renameTunnel(id: string, peerId: string, label: string): Promise<Device>;
  deleteTunnel(id: string, peerId: string): Promise<void>;
  deviceStats(id: string, options?: DeviceStatsQueryOptions): Promise<DeviceStats>;
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

  async profileByPeer(id: string, peerId: string): Promise<Profile> {
    return this.repository.profileByPeer(
      requireId(id, "Устройство"),
      requireId(peerId, "Туннель"),
    );
  }

  async addTunnel(id: string, interfaceId: string, label?: string): Promise<Device> {
    const trimmed = label?.trim() ?? "";
    if (trimmed.length > PEER_LABEL_MAX) {
      throw new ValidationError(`Метка туннеля: не длиннее ${PEER_LABEL_MAX} символов`);
    }
    return this.repository.addTunnel(requireId(id, "Устройство"), {
      interfaceId: requireId(interfaceId, "Интерфейс"),
      ...(trimmed.length > 0 ? { label: trimmed } : {}),
    });
  }

  async renameTunnel(id: string, peerId: string, label: string): Promise<Device> {
    return this.repository.renameTunnel(
      requireId(id, "Устройство"),
      requireId(peerId, "Туннель"),
      requirePeerLabel(label),
    );
  }

  async deleteTunnel(id: string, peerId: string): Promise<void> {
    await this.repository.deleteTunnel(
      requireId(id, "Устройство"),
      requireId(peerId, "Туннель"),
    );
  }

  async deviceStats(id: string, options: DeviceStatsQueryOptions = {}): Promise<DeviceStats> {
    const normalized = requireId(id, "Устройство");
    return options.signal === undefined
      ? this.repository.deviceStats(normalized)
      : this.repository.deviceStats(normalized, options);
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
