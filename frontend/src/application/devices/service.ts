import type { BulkResult } from "@/domain/bulk";
import type { DevicesBulkAction, DevicesRepository } from "@/domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DevicePageParams,
  DeviceStatusFilter,
  DeviceStats,
  DeviceStatsQueryOptions,
  DeviceUpdateInput,
} from "@/domain/devices/types";
import type { Page } from "@/domain/page";
import { normalizePageRequest } from "@/domain/page";
import type { Device, Profile, ShareLink } from "@/domain/types";
import { ValidationError } from "../errors";
import { PEER_LABEL_MAX, requireId, requirePeerLabel, requireRate, requireText } from "../guards";

export interface DevicesService {
  listDevices(): Promise<Device[]>;
  pageDevices(params: DevicePageParams): Promise<Page<Device>>;
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

  pageDevices(params: DevicePageParams): Promise<Page<Device>> {
    return this.repository.pageDevices(normalizeDevicePageParams(params));
  }

  async getDevice(id: string): Promise<Device> {
    return this.repository.getDevice(requireId(id, "error.label.device"));
  }

  async createDevice(input: DeviceInput): Promise<Device> {
    const interfaceIds = normalizeInterfaceIds(input);
    const primary = interfaceIds[0];
    return this.repository.createDevice({
      user_id: input.user_id,
      group_id: input.group_id,
      ...(primary ? { interface_id: primary } : {}),
      ...(interfaceIds.length > 0 ? { interface_ids: interfaceIds } : {}),
      name: requireText(input.name, "error.label.deviceName"),
      down_kbps: requireRate(input.down_kbps, "error.label.downRate"),
      up_kbps: requireRate(input.up_kbps, "error.label.upRate"),
      forwarding: input.forwarding,
    });
  }

  async updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    const patch: DeviceUpdateInput = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "error.label.deviceName");
    if (input.down_kbps !== undefined) {
      patch.down_kbps = requireRate(input.down_kbps, "error.label.downRate");
    }
    if (input.up_kbps !== undefined) {
      patch.up_kbps = requireRate(input.up_kbps, "error.label.upRate");
    }
    return this.repository.updateDevice(requireId(id, "error.label.device"), patch);
  }

  async deleteDevice(id: string): Promise<void> {
    await this.repository.deleteDevice(requireId(id, "error.label.device"));
  }

  async listProfiles(id: string): Promise<Profile[]> {
    return this.repository.listProfiles(requireId(id, "error.label.device"));
  }

  async getProfile(id: string, interfaceId: string): Promise<Profile> {
    return this.repository.getProfile(
      requireId(id, "error.label.device"),
      requireId(interfaceId, "error.label.interface"),
    );
  }

  async profileByPeer(id: string, peerId: string): Promise<Profile> {
    return this.repository.profileByPeer(
      requireId(id, "error.label.device"),
      requireId(peerId, "error.label.tunnel"),
    );
  }

  async addTunnel(id: string, interfaceId: string, label?: string): Promise<Device> {
    const trimmed = label?.trim() ?? "";
    if (trimmed.length > PEER_LABEL_MAX) {
      throw new ValidationError("error.validation.peerLabelTooLong", {
        label: "error.label.tunnelLabel",
        max: PEER_LABEL_MAX,
      });
    }
    return this.repository.addTunnel(requireId(id, "error.label.device"), {
      interfaceId: requireId(interfaceId, "error.label.interface"),
      ...(trimmed.length > 0 ? { label: trimmed } : {}),
    });
  }

  async renameTunnel(id: string, peerId: string, label: string): Promise<Device> {
    return this.repository.renameTunnel(
      requireId(id, "error.label.device"),
      requireId(peerId, "error.label.tunnel"),
      requirePeerLabel(label),
    );
  }

  async deleteTunnel(id: string, peerId: string): Promise<void> {
    await this.repository.deleteTunnel(
      requireId(id, "error.label.device"),
      requireId(peerId, "error.label.tunnel"),
    );
  }

  async deviceStats(id: string, options: DeviceStatsQueryOptions = {}): Promise<DeviceStats> {
    const normalized = requireId(id, "error.label.device");
    return options.signal === undefined
      ? this.repository.deviceStats(normalized)
      : this.repository.deviceStats(normalized, options);
  }

  async listShares(id: string): Promise<ShareLink[]> {
    return this.repository.listShares(requireId(id, "error.label.device"));
  }

  async createShare(id: string, input: CreateShareInput): Promise<ShareLink> {
    if (input.ttlSecs !== undefined && (!Number.isInteger(input.ttlSecs) || input.ttlSecs <= 0)) {
      throw new ValidationError("error.validation.shareTtl");
    }
    if (input.oneTime && input.maxUses !== undefined) {
      throw new ValidationError("error.validation.shareOneTimeLimit");
    }
    const maxUses = input.maxUses;
    if (
      !input.oneTime &&
      maxUses !== undefined &&
      (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
    ) {
      throw new ValidationError("error.validation.shareMaxUses");
    }
    return this.repository.createShare(requireId(id, "error.label.device"), {
      interfaceId: requireId(input.interfaceId, "error.label.interface"),
      format: input.format,
      ...(input.ttlSecs !== undefined ? { ttlSecs: input.ttlSecs } : {}),
      ...(input.oneTime === true ? { oneTime: true } : {}),
      ...(input.oneTime !== true && maxUses !== undefined ? { maxUses } : {}),
    });
  }

  async revokeShare(token: string): Promise<void> {
    await this.repository.revokeShare(requireId(token, "error.label.share"));
  }

  async revokeAllShares(id: string): Promise<number> {
    return this.repository.revokeAllShares(requireId(id, "error.label.device"));
  }

  async bulk(action: DevicesBulkAction, ids: readonly string[]): Promise<BulkResult> {
    const normalized = ids.map((id) => requireId(id, "error.label.device"));
    return this.repository.bulk(action, normalized);
  }
}

function normalizeInterfaceIds(input: DeviceInput): string[] {
  const ids: string[] = [];
  if (input.interface_id) ids.push(input.interface_id.trim());
  for (const id of input.interface_ids ?? []) ids.push(id.trim());
  return Array.from(new Set(ids.filter((id) => id.length > 0)));
}

function normalizeDevicePageParams(params: DevicePageParams): DevicePageParams {
  const { limit, offset } = normalizePageRequest(params);
  const query = params.query?.trim() ?? "";
  const interfaceId = params.interfaceId?.trim() ?? "";
  const userId = params.userId?.trim() ?? "";
  const status = normalizeStatus(params.status);
  const sort = params.sort === "name" || params.sort === "created" ? params.sort : undefined;
  const order = params.order === "asc" || params.order === "desc" ? params.order : undefined;
  return {
    limit,
    offset,
    ...(query.length > 0 ? { query } : {}),
    ...(status === undefined ? {} : { status }),
    ...(interfaceId.length > 0 ? { interfaceId } : {}),
    ...(userId.length > 0 ? { userId } : {}),
    ...(sort === undefined ? {} : { sort }),
    ...(order === undefined ? {} : { order }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
  };
}

function normalizeStatus(value: DeviceStatusFilter | undefined): DeviceStatusFilter | undefined {
  if (value === "active" || value === "revoked") return value;
  return undefined;
}
