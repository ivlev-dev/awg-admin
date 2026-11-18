import type { BulkResult } from "../bulk";
import type { Device, Profile, ShareLink } from "../types";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
  TunnelInput,
} from "./types";
export type DevicesBulkAction = "revoke_shares" | "delete";

export interface DevicesRepository {
  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device>;
  createDevice(input: DeviceInput): Promise<Device>;
  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  listProfiles(id: string): Promise<Profile[]>;
  getProfile(id: string, interfaceId: string): Promise<Profile>;
  profileByPeer(id: string, peerId: string): Promise<Profile>;
  addTunnel(id: string, input: TunnelInput): Promise<Device>;
  renameTunnel(id: string, peerId: string, label: string): Promise<Device>;
  deleteTunnel(id: string, peerId: string): Promise<void>;
  deviceStats(id: string): Promise<DeviceStats>;
  listShares(id: string): Promise<ShareLink[]>;
  createShare(id: string, input: CreateShareInput): Promise<ShareLink>;
  revokeShare(token: string): Promise<void>;
  revokeAllShares(id: string): Promise<number>;
  bulk(action: DevicesBulkAction, ids: readonly string[]): Promise<BulkResult>;
}
