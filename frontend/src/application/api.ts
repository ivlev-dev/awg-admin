import type {
  AuthSession,
  CidrPool,
  Device,
  Group,
  ImportResult,
  InterfaceInfo,
  NodeInfo,
  Overview,
  Profile,
  Settings,
  ShareFormat,
  ShareLink,
  StatsPoint,
  Tariff,
  User,
} from "@/domain/types";
import type { LoginInput } from "@/domain/auth/types";
import type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { TariffInput } from "@/domain/tariffs/types";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { NodeCreated } from "@/domain/nodes/types";
import type { InterfaceInput } from "@/domain/interfaces/types";
import type { DeviceInput, DeviceStats, DeviceUpdateInput } from "@/domain/devices/types";
import type { ImportInput } from "@/domain/import/types";

export type { LoginInput } from "@/domain/auth/types";
export type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
export type { TariffInput } from "@/domain/tariffs/types";
export type { GroupInput, PoolInput } from "@/domain/groups/types";
export type { NodeCreated } from "@/domain/nodes/types";
export type { InterfaceInput } from "@/domain/interfaces/types";
export type {
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
} from "@/domain/devices/types";
export type { ImportInput } from "@/domain/import/types";

export interface AdminApi {
  login(input: LoginInput): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<User>;
  changePassword(current: string | null, next: string): Promise<void>;

  listUsers(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;

  listTariffs(): Promise<Tariff[]>;
  createTariff(input: TariffInput): Promise<Tariff>;
  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff>;
  deleteTariff(id: string): Promise<void>;

  listGroups(): Promise<Group[]>;
  createGroup(input: GroupInput): Promise<Group>;
  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group>;
  deleteGroup(id: string): Promise<void>;

  listPools(groupId: string): Promise<CidrPool[]>;
  createPool(groupId: string, input: PoolInput): Promise<CidrPool>;
  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool>;
  deletePool(id: string): Promise<void>;

  listNodes(): Promise<NodeInfo[]>;
  createNode(name: string): Promise<NodeCreated>;
  deleteNode(id: string): Promise<void>;

  listInterfaces(): Promise<InterfaceInfo[]>;
  createInterface(input: InterfaceInput): Promise<InterfaceInfo>;
  updateInterface(id: string, input: Partial<Omit<InterfaceInput, "group_id" | "node_id" | "name">> & { enabled?: boolean }): Promise<InterfaceInfo>;
  rotateInterface(id: string): Promise<InterfaceInfo>;
  deleteInterface(id: string): Promise<void>;

  listDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device>;
  createDevice(input: DeviceInput): Promise<Device>;
  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  listProfiles(id: string): Promise<Profile[]>;
  getProfile(id: string, interfaceId: string): Promise<Profile>;
  deviceStats(id: string): Promise<DeviceStats>;
  listShares(id: string): Promise<ShareLink[]>;
  createShare(id: string, interfaceId: string, format: ShareFormat, ttlSecs?: number): Promise<ShareLink>;
  revokeShare(token: string): Promise<void>;

  overview(): Promise<Overview>;
  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]>;

  getSettings(): Promise<Settings>;
  updateSettings(input: Partial<Settings>): Promise<Settings>;

  importConfig(input: ImportInput): Promise<ImportResult>;
}
