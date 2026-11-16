import type {
  AuthSession,
  CidrPool,
  Device,
  Group,
  ImportResult,
  InterfaceInfo,
  NodeInfo,
  Overview,
  PoolMode,
  Profile,
  Role,
  Settings,
  ShareFormat,
  ShareLink,
  StatsPoint,
  Tariff,
  User,
  Forwarding,
} from "@/domain/types";

export interface LoginInput {
  login: string;
  password: string;
}

export interface CreateUserInput {
  login: string;
  password: string;
  role: Role;
  tariff_id: string | null;
  group_id: string | null;
}

export interface UpdateUserInput {
  role?: Role;
  tariff_id?: string | null;
  group_id?: string | null;
  disabled?: boolean;
}

export interface TariffInput {
  name: string;
  description: string;
  max_devices: number;
  device_down_kbps: number;
  device_up_kbps: number;
  group_down_kbps: number;
  group_up_kbps: number;
  traffic_quota_bytes: number | null;
}

export interface GroupInput {
  name: string;
  description: string;
  base_cidr: string;
  forwarding_default: boolean;
}

export interface PoolInput {
  name: string;
  cidr: string;
  mode: PoolMode;
  gateway: string | null;
}

export interface InterfaceInput {
  group_id: string;
  node_id: string;
  name: string;
  label: string;
  endpoint_host: string;
  endpoint_port: number;
  listen_port: number;
  mtu: number;
}

export interface DeviceInput {
  user_id: string | null;
  group_id: string | null;
  name: string;
  down_kbps: number;
  up_kbps: number;
  forwarding: Forwarding | null;
}

export interface DeviceUpdateInput {
  name?: string;
  down_kbps?: number;
  up_kbps?: number;
  forwarding?: Forwarding;
  revoked?: boolean;
}

export interface ImportInput {
  server_config: string;
  node_id: string;
  group_name: string;
  group_description: string;
  base_cidr: string;
  pools: PoolInput[];
  interface: {
    name: string;
    endpoint_host: string;
    endpoint_port: number;
    listen_port: number;
    mtu: number;
  };
  clients: Array<{ name: string; config: string }>;
  owner_user_id: string | null;
}

export interface NodeCreated {
  node: { id: string; name: string; created_at: string };
  token: string;
}

export interface DeviceStats {
  device_id: string;
  today: { rx: number; tx: number };
  month: { rx: number; tx: number };
}

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
