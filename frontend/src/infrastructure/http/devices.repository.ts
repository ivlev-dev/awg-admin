import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { DevicesBulkAction, DevicesRepository } from "@/domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceStatsQueryOptions,
  DeviceUpdateInput,
  TunnelInput,
} from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import type { HttpClient } from "./client";
import { readDevice, readDevices, readShareLink, readShareLinks } from "./response";

export class HttpDevicesRepository implements DevicesRepository {
  constructor(private readonly client: HttpClient) {}

  listDevices(): Promise<Device[]> {
    return this.client.get<unknown>("/devices").then(readDevices);
  }

  getDevice(id: string): Promise<Device> {
    return this.client.get<unknown>(`/devices/${id}`).then(readDevice);
  }

  createDevice(input: DeviceInput): Promise<Device> {
    return this.client.post<unknown>("/devices", {
      user_id: input.user_id,
      group_id: input.group_id,
      ...(input.interface_id ? { interface_id: input.interface_id } : {}),
      ...(input.interface_ids && input.interface_ids.length > 0
        ? { interface_ids: input.interface_ids }
        : {}),
      name: input.name,
      down_kbps: input.down_kbps,
      up_kbps: input.up_kbps,
      forwarding: input.forwarding,
    }).then(readDevice);
  }

  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    return this.client.patch<unknown>(`/devices/${id}`, input).then(readDevice);
  }

  async deleteDevice(id: string): Promise<void> {
    await this.client.delete(`/devices/${id}`);
  }

  listProfiles(id: string): Promise<Profile[]> {
    return this.client.get<Profile[]>(`/devices/${id}/profiles`);
  }

  getProfile(id: string, interfaceId: string): Promise<Profile> {
    return this.client.get<Profile>(`/devices/${id}/profiles/${interfaceId}`);
  }

  profileByPeer(id: string, peerId: string): Promise<Profile> {
    return this.client.get<Profile>(
      `/devices/${id}/profiles/by-peer/${encodeURIComponent(peerId)}`,
    );
  }

  addTunnel(id: string, input: TunnelInput): Promise<Device> {
    return this.client
      .post<unknown>(`/devices/${id}/tunnels`, {
        interface_id: input.interfaceId,
        ...(input.label === undefined ? {} : { label: input.label }),
      })
      .then(readDevice);
  }

  renameTunnel(id: string, peerId: string, label: string): Promise<Device> {
    return this.client
      .patch<unknown>(`/devices/${id}/tunnels/${encodeURIComponent(peerId)}`, { label })
      .then(readDevice);
  }

  async deleteTunnel(id: string, peerId: string): Promise<void> {
    await this.client.delete(`/devices/${id}/tunnels/${encodeURIComponent(peerId)}`);
  }

  deviceStats(id: string, options: DeviceStatsQueryOptions = {}): Promise<DeviceStats> {
    return this.client.get<DeviceStats>(
      `/devices/${id}/stats`,
      options.signal === undefined ? {} : { signal: options.signal },
    );
  }

  listShares(id: string): Promise<ShareLink[]> {
    return this.client.get<unknown>(`/devices/${id}/shares`).then(readShareLinks);
  }

  createShare(id: string, input: CreateShareInput): Promise<ShareLink> {
    return this.client.post<unknown>(`/devices/${id}/shares`, {
      interface_id: input.interfaceId,
      format: input.format,
      ttl_secs: input.ttlSecs ?? null,
      max_uses: input.oneTime === true ? null : (input.maxUses ?? null),
      one_time: input.oneTime === true,
    }).then(readShareLink);
  }

  async revokeShare(token: string): Promise<void> {
    await this.client.delete(`/shares/${token}`);
  }

  async revokeAllShares(id: string): Promise<number> {
    const result = await this.client.delete<{ revoked: number }>(`/devices/${id}/shares`);
    return result.revoked;
  }

  bulk(action: DevicesBulkAction, ids: readonly string[]): Promise<BulkResult> {
    const body: BulkRequest<DevicesBulkAction> = { action, ids };
    return this.client.post<BulkResult>("/devices/bulk", body);
  }
}
