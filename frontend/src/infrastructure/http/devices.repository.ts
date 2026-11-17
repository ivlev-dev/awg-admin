import type { DevicesRepository } from "@/domain/devices/repository";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
} from "@/domain/devices/types";
import type { Device, Profile, ShareLink } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpDevicesRepository implements DevicesRepository {
  constructor(private readonly client: HttpClient) {}

  listDevices(): Promise<Device[]> {
    return this.client.get<Device[]>("/devices");
  }

  getDevice(id: string): Promise<Device> {
    return this.client.get<Device>(`/devices/${id}`);
  }

  createDevice(input: DeviceInput): Promise<Device> {
    return this.client.post<Device>("/devices", input);
  }

  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    return this.client.patch<Device>(`/devices/${id}`, input);
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

  deviceStats(id: string): Promise<DeviceStats> {
    return this.client.get<DeviceStats>(`/devices/${id}/stats`);
  }

  listShares(id: string): Promise<ShareLink[]> {
    return this.client.get<ShareLink[]>(`/devices/${id}/shares`);
  }

  createShare(id: string, input: CreateShareInput): Promise<ShareLink> {
    return this.client.post<ShareLink>(`/devices/${id}/shares`, {
      interface_id: input.interfaceId,
      format: input.format,
      ttl_secs: input.ttlSecs ?? null,
      max_uses: input.oneTime === true ? null : (input.maxUses ?? null),
      one_time: input.oneTime === true,
    });
  }

  async revokeShare(token: string): Promise<void> {
    await this.client.delete(`/shares/${token}`);
  }

  async revokeAllShares(id: string): Promise<number> {
    const result = await this.client.delete<{ revoked: number }>(`/devices/${id}/shares`);
    return result.revoked;
  }
}
