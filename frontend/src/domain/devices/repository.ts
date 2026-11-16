import type { Device, Profile, ShareLink } from "../types";
import type {
  CreateShareInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
} from "./types";

export interface DevicesRepository {
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
}
