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
import type {
  AdminApi,
  CreateUserInput,
  DeviceInput,
  DeviceStats,
  DeviceUpdateInput,
  GroupInput,
  ImportInput,
  InterfaceInput,
  LoginInput,
  NodeCreated,
  PoolInput,
  TariffInput,
  UpdateUserInput,
} from "@/application/api";
import type { TokenStore } from "./storage";
import type { HttpBackend } from "./http/backend";
import { createHttpBackend } from "./http/backend";
import { DEFAULT_TIMEOUT_MS } from "./http/config";

export { ApiError } from "./http/errors";

export class HttpApi implements AdminApi {
  private readonly backend: HttpBackend;

  constructor(tokens: TokenStore, base = "/api/v1", backend?: HttpBackend) {
    this.backend = backend ?? createHttpBackend({
      tokens,
      config: { baseUrl: base, timeoutMs: DEFAULT_TIMEOUT_MS },
      session: { clear: () => tokens.clear() },
    });
  }

  login(input: LoginInput): Promise<AuthSession> {
    return this.backend.repositories.auth.login(input);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return this.backend.repositories.auth.refresh(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.backend.repositories.auth.logout(refreshToken);
  }

  me(): Promise<User> {
    return this.backend.repositories.auth.me();
  }

  changePassword(current: string | null, next: string): Promise<void> {
    return this.backend.repositories.auth.changePassword(current, next);
  }

  listUsers(): Promise<User[]> {
    return this.backend.repositories.users.listUsers();
  }

  createUser(input: CreateUserInput): Promise<User> {
    return this.backend.repositories.users.createUser(input);
  }

  updateUser(id: string, input: UpdateUserInput): Promise<User> {
    return this.backend.repositories.users.updateUser(id, input);
  }

  deleteUser(id: string): Promise<void> {
    return this.backend.repositories.users.deleteUser(id);
  }

  resetPassword(id: string, password: string): Promise<void> {
    return this.backend.repositories.users.resetPassword(id, password);
  }

  listTariffs(): Promise<Tariff[]> {
    return this.backend.repositories.tariffs.listTariffs();
  }

  createTariff(input: TariffInput): Promise<Tariff> {
    return this.backend.repositories.tariffs.createTariff(input);
  }

  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    return this.backend.repositories.tariffs.updateTariff(id, input);
  }

  deleteTariff(id: string): Promise<void> {
    return this.backend.repositories.tariffs.deleteTariff(id);
  }

  listGroups(): Promise<Group[]> {
    return this.backend.repositories.groups.listGroups();
  }

  createGroup(input: GroupInput): Promise<Group> {
    return this.backend.repositories.groups.createGroup(input);
  }

  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    return this.backend.repositories.groups.updateGroup(id, input);
  }

  deleteGroup(id: string): Promise<void> {
    return this.backend.repositories.groups.deleteGroup(id);
  }

  listPools(groupId: string): Promise<CidrPool[]> {
    return this.backend.repositories.groups.listPools(groupId);
  }

  createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return this.backend.repositories.groups.createPool(groupId, input);
  }

  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> {
    return this.backend.repositories.groups.updatePool(id, input);
  }

  deletePool(id: string): Promise<void> {
    return this.backend.repositories.groups.deletePool(id);
  }

  listNodes(): Promise<NodeInfo[]> {
    return this.backend.repositories.nodes.listNodes();
  }

  createNode(name: string): Promise<NodeCreated> {
    return this.backend.repositories.nodes.createNode(name);
  }

  deleteNode(id: string): Promise<void> {
    return this.backend.repositories.nodes.deleteNode(id);
  }

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.backend.repositories.interfaces.listInterfaces();
  }

  createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.backend.repositories.interfaces.createInterface(input);
  }

  updateInterface(
    id: string,
    input: Partial<Omit<InterfaceInput, "group_id" | "node_id" | "name">> & { enabled?: boolean },
  ): Promise<InterfaceInfo> {
    return this.backend.repositories.interfaces.updateInterface(id, input);
  }

  rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.backend.repositories.interfaces.rotateInterface(id);
  }

  deleteInterface(id: string): Promise<void> {
    return this.backend.repositories.interfaces.deleteInterface(id);
  }

  listDevices(): Promise<Device[]> {
    return this.backend.repositories.devices.listDevices();
  }

  getDevice(id: string): Promise<Device> {
    return this.backend.repositories.devices.getDevice(id);
  }

  createDevice(input: DeviceInput): Promise<Device> {
    return this.backend.repositories.devices.createDevice(input);
  }

  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    return this.backend.repositories.devices.updateDevice(id, input);
  }

  deleteDevice(id: string): Promise<void> {
    return this.backend.repositories.devices.deleteDevice(id);
  }

  listProfiles(id: string): Promise<Profile[]> {
    return this.backend.repositories.devices.listProfiles(id);
  }

  getProfile(id: string, interfaceId: string): Promise<Profile> {
    return this.backend.repositories.devices.getProfile(id, interfaceId);
  }

  deviceStats(id: string): Promise<DeviceStats> {
    return this.backend.repositories.devices.deviceStats(id);
  }

  listShares(id: string): Promise<ShareLink[]> {
    return this.backend.repositories.devices.listShares(id);
  }

  createShare(
    id: string,
    interfaceId: string,
    format: ShareFormat,
    ttlSecs?: number,
  ): Promise<ShareLink> {
    return this.backend.repositories.devices.createShare(id, {
      interfaceId,
      format,
      ...(ttlSecs !== undefined ? { ttlSecs } : {}),
    });
  }

  revokeShare(token: string): Promise<void> {
    return this.backend.repositories.devices.revokeShare(token);
  }

  overview(): Promise<Overview> {
    return this.backend.repositories.stats.overview();
  }

  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    return this.backend.repositories.stats.series(scope, id, from, to);
  }

  getSettings(): Promise<Settings> {
    return this.backend.repositories.settings.getSettings();
  }

  updateSettings(input: Partial<Settings>): Promise<Settings> {
    return this.backend.repositories.settings.updateSettings(input);
  }

  importConfig(input: ImportInput): Promise<ImportResult> {
    return this.backend.repositories.import.importConfig(input);
  }
}
