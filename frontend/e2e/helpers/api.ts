import { request, type APIRequestContext, type APIResponse } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8081";
export const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? "admin";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin12345";
export const DEFAULT_USER_PASSWORD = "e2e-pass-12345";

const API_PREFIX = "/api/v1";

export interface UserAccount {
  id: string;
  login: string;
  role: "admin" | "user";
  tariff_id: string | null;
  group_id: string | null;
}

export interface AuthView {
  token: string;
  refresh_token: string;
  expires_in: number;
  user: UserAccount;
}

export interface GroupView {
  id: string;
  name: string;
  base_cidr: string;
}

export interface PoolView {
  id: string;
  group_id: string;
  name: string;
  cidr: string;
}

export interface NodeCreated {
  node: { id: string; name: string };
  token: string;
}

export interface InterfaceView {
  id: string;
  group_id: string;
  node_id: string;
  name: string;
}

export interface TariffView {
  id: string;
  name: string;
  traffic_quota_bytes: number | null;
}

export interface DeviceView {
  id: string;
  user_id: string;
  group_id: string;
  name: string;
  addresses: string[];
  forwarding: { to_own_devices: boolean; allowed_devices: string[] };
}

export interface DevMail {
  to: string;
  subject: string;
  link: string;
  body: string;
  created_at: string;
}

export interface PendingUser {
  id: string;
  login: string;
  email: string | null;
  status: "pending_email" | "pending_approval" | "active" | "rejected";
}

export interface LoginAttempt {
  ok: boolean;
  status: number;
  code: string | null;
}

export interface WorkspaceOptions {
  quotaBytes?: number | null;
  maxDevices?: number;
  password?: string;
}

export interface Workspace {
  suffix: string;
  cidr: string;
  groupId: string;
  groupName: string;
  poolId: string;
  nodeId: string;
  interfaceId: string;
  interfaceName: string;
  tariffId: string;
  userId: string;
  login: string;
  password: string;
}

export function uniqueSuffix(): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${stamp}${random}`;
}

function uniqueCidr(): string {
  const second = 100 + Math.floor(Math.random() * 120);
  const third = Math.floor(Math.random() * 254);
  return `10.${second}.${third}.0/24`;
}

function interfaceName(suffix: string): string {
  const tail = suffix.replace(/[^a-z0-9]/gi, "").slice(-11);
  return `awg${tail}`.slice(0, 15);
}

async function readJson<T>(
  response: APIResponse,
  method: string,
  path: string,
): Promise<T> {
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${response.status()}: ${body}`);
  }
  if (response.status() === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export class E2EApi {
  private token: string | null = null;

  private constructor(private readonly context: APIRequestContext) {}

  static async create(): Promise<E2EApi> {
    const context = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Accept: "application/json" },
    });
    return new E2EApi(context);
  }

  async close(): Promise<void> {
    await this.context.dispose();
  }

  async login(login: string = ADMIN_LOGIN, password: string = ADMIN_PASSWORD): Promise<AuthView> {
    const auth = await this.post<AuthView>("/auth/login", { login, password });
    this.token = auth.token;
    return auth;
  }

  async me(): Promise<UserAccount> {
    return this.get<UserAccount>("/auth/me");
  }

  async createGroup(name: string, cidr: string): Promise<GroupView> {
    return this.post<GroupView>("/groups", {
      name,
      description: "e2e fixture",
      base_cidr: cidr,
      forwarding_default: false,
    });
  }

  async createPool(groupId: string, name: string, cidr: string): Promise<PoolView> {
    return this.post<PoolView>(`/groups/${groupId}/pools`, {
      name,
      cidr,
      mode: "auto",
      gateway: null,
    });
  }

  async createNode(name: string): Promise<NodeCreated> {
    return this.post<NodeCreated>("/nodes", { name });
  }

  async createInterface(input: {
    groupId: string;
    nodeId: string;
    name: string;
  }): Promise<InterfaceView> {
    return this.post<InterfaceView>("/interfaces", {
      group_id: input.groupId,
      node_id: input.nodeId,
      name: input.name,
      label: "e2e",
      endpoint_host: "e2e.example.com",
      endpoint_port: 51820,
      listen_port: 51820,
      mtu: 1420,
    });
  }

  async createTariff(input: {
    name: string;
    quotaBytes: number | null;
    maxDevices: number;
  }): Promise<TariffView> {
    return this.post<TariffView>("/tariffs", {
      name: input.name,
      description: "e2e fixture",
      max_devices: input.maxDevices,
      device_down_kbps: 10_000,
      device_up_kbps: 10_000,
      group_down_kbps: 100_000,
      group_up_kbps: 100_000,
      traffic_quota_bytes: input.quotaBytes,
    });
  }

  async createUser(input: {
    login: string;
    password: string;
    role: "admin" | "user";
    tariffId: string | null;
    groupId: string | null;
  }): Promise<UserAccount> {
    return this.post<UserAccount>("/users", {
      login: input.login,
      password: input.password,
      role: input.role,
      tariff_id: input.tariffId,
      group_id: input.groupId,
    });
  }

  async createDevice(input: {
    userId: string;
    groupId: string;
    name: string;
  }): Promise<DeviceView> {
    return this.post<DeviceView>("/devices", {
      user_id: input.userId,
      group_id: input.groupId,
      name: input.name,
      down_kbps: 1000,
      up_kbps: 1000,
      forwarding: { to_own_devices: false, allowed_devices: [] },
    });
  }

  async findDeviceByName(name: string): Promise<DeviceView | undefined> {
    const devices = await this.get<DeviceView[]>("/devices");
    return devices.find((device) => device.name === name);
  }

  async listDevices(): Promise<DeviceView[]> {
    return this.get<DeviceView[]>("/devices");
  }

  async listInterfaces(): Promise<InterfaceView[]> {
    return this.get<InterfaceView[]>("/interfaces");
  }

  async listGroups(): Promise<GroupView[]> {
    return this.get<GroupView[]>("/groups");
  }

  async listPendingUsers(): Promise<PendingUser[]> {
    return this.get<PendingUser[]>("/users/pending");
  }

  async approveUser(input: {
    userId: string;
    tariffId: string;
    groupId?: string | null;
  }): Promise<PendingUser> {
    return this.post<PendingUser>(`/users/${input.userId}/approve`, {
      tariff_id: input.tariffId,
      group_id: input.groupId ?? null,
    });
  }

  async attemptLogin(login: string, password: string): Promise<LoginAttempt> {
    const response = await this.context.post(`${API_PREFIX}/auth/login`, {
      data: { login, password },
      headers: { Accept: "application/json" },
    });
    if (response.ok()) return { ok: true, status: response.status(), code: null };
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    return {
      ok: false,
      status: response.status(),
      code: payload?.error?.code ?? null,
    };
  }

  async register(input: { email: string; password: string; login?: string }): Promise<void> {
    const response = await this.context.post(`${API_PREFIX}/auth/register`, {
      data: input,
      headers: { Accept: "application/json" },
    });
    await readJson<unknown>(response, "POST", "/auth/register");
  }

  async verifyEmail(token: string): Promise<void> {
    const response = await this.context.post(`${API_PREFIX}/auth/verify-email`, {
      data: { token },
      headers: { Accept: "application/json" },
    });
    await readJson<unknown>(response, "POST", "/auth/verify-email");
  }

  async devMail(): Promise<DevMail[]> {
    return this.get<DevMail[]>("/dev/mail");
  }

  async clearDevMail(): Promise<void> {
    const response = await this.context.delete(`${API_PREFIX}/dev/mail`);
    if (!response.ok() && response.status() !== 404) {
      const body = await response.text().catch(() => "");
      throw new Error(`DELETE /dev/mail -> ${response.status()}: ${body}`);
    }
  }

  async waitForMail(to: string, timeoutMs = 10_000): Promise<DevMail> {
    const deadline = Date.now() + timeoutMs;
    let lastCount = 0;
    while (Date.now() < deadline) {
      const messages = await this.devMail();
      lastCount = messages.length;
      const match = messages.filter((message) => message.to === to).at(-1);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`no dev mail for ${to} (mailbox size: ${lastCount})`);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.context.get(`${API_PREFIX}${path}`, { headers: this.headers() });
    return readJson<T>(response, "GET", path);
  }

  private async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.context.post(`${API_PREFIX}${path}`, {
      data,
      headers: this.headers(),
    });
    return readJson<T>(response, "POST", path);
  }

  private headers(): Record<string, string> {
    return this.token === null ? {} : { Authorization: `Bearer ${this.token}` };
  }
}

export async function createWorkspace(
  api: E2EApi,
  options: WorkspaceOptions = {},
): Promise<Workspace> {
  const suffix = uniqueSuffix();
  const cidr = uniqueCidr();
  const password = options.password ?? DEFAULT_USER_PASSWORD;
  const group = await api.createGroup(`e2e-group-${suffix}`, cidr);
  const pool = await api.createPool(group.id, `pool-${suffix}`, cidr);
  const node = await api.createNode(`e2e-node-${suffix}`);
  const iface = await api.createInterface({
    groupId: group.id,
    nodeId: node.node.id,
    name: interfaceName(suffix),
  });
  const tariff = await api.createTariff({
    name: `e2e-tariff-${suffix}`,
    quotaBytes: options.quotaBytes ?? null,
    maxDevices: options.maxDevices ?? 16,
  });
  const login = `e2e-user-${suffix}`;
  const user = await api.createUser({
    login,
    password,
    role: "user",
    tariffId: tariff.id,
    groupId: group.id,
  });
  return {
    suffix,
    cidr,
    groupId: group.id,
    groupName: group.name,
    poolId: pool.id,
    nodeId: node.node.id,
    interfaceId: iface.id,
    interfaceName: iface.name,
    tariffId: tariff.id,
    userId: user.id,
    login,
    password,
  };
}

export async function createUserOnly(
  api: E2EApi,
  role: "admin" | "user" = "user",
): Promise<{ login: string; password: string; userId: string }> {
  const suffix = uniqueSuffix();
  const login = `e2e-${role}-${suffix}`;
  const password = DEFAULT_USER_PASSWORD;
  const user = await api.createUser({
    login,
    password,
    role,
    tariffId: null,
    groupId: null,
  });
  return { login, password, userId: user.id };
}
