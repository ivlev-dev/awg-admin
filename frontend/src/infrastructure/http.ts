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
import type { LocalTokenStore } from "./storage";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export class HttpApi implements AdminApi {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly tokens: LocalTokenStore,
    private readonly base: string = "/api/v1",
  ) {}

  async login(input: LoginInput): Promise<AuthSession> {
    const session = await this.request<AuthSession>("POST", "/auth/login", input, false);
    this.tokens.set(session.token, session.refresh_token);
    return session;
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const session = await this.request<AuthSession>(
      "POST",
      "/auth/refresh",
      { refresh_token: refreshToken },
      false,
    );
    this.tokens.set(session.token, session.refresh_token);
    return session;
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await this.request<void>("POST", "/auth/logout", { refresh_token: refreshToken }, false);
    } finally {
      this.tokens.clear();
    }
  }

  me(): Promise<User> {
    return this.request<User>("GET", "/auth/me");
  }

  async changePassword(current: string | null, next: string): Promise<void> {
    await this.request<void>("POST", "/auth/password", {
      current_password: current,
      new_password: next,
    });
  }

  listUsers(): Promise<User[]> {
    return this.request<User[]>("GET", "/users");
  }

  createUser(input: CreateUserInput): Promise<User> {
    return this.request<User>("POST", "/users", input);
  }

  updateUser(id: string, input: UpdateUserInput): Promise<User> {
    return this.request<User>("PATCH", `/users/${id}`, input);
  }

  async deleteUser(id: string): Promise<void> {
    await this.request<void>("DELETE", `/users/${id}`);
  }

  async resetPassword(id: string, password: string): Promise<void> {
    await this.request<void>("POST", `/users/${id}/password`, { new_password: password });
  }

  listTariffs(): Promise<Tariff[]> {
    return this.request<Tariff[]>("GET", "/tariffs");
  }

  createTariff(input: TariffInput): Promise<Tariff> {
    return this.request<Tariff>("POST", "/tariffs", input);
  }

  updateTariff(id: string, input: Partial<TariffInput>): Promise<Tariff> {
    return this.request<Tariff>("PATCH", `/tariffs/${id}`, input);
  }

  async deleteTariff(id: string): Promise<void> {
    await this.request<void>("DELETE", `/tariffs/${id}`);
  }

  listGroups(): Promise<Group[]> {
    return this.request<Group[]>("GET", "/groups");
  }

  createGroup(input: GroupInput): Promise<Group> {
    return this.request<Group>("POST", "/groups", input);
  }

  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    return this.request<Group>("PATCH", `/groups/${id}`, input);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.request<void>("DELETE", `/groups/${id}`);
  }

  listPools(groupId: string): Promise<CidrPool[]> {
    return this.request<CidrPool[]>("GET", `/groups/${groupId}/pools`);
  }

  createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return this.request<CidrPool>("POST", `/groups/${groupId}/pools`, input);
  }

  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> {
    return this.request<CidrPool>("PATCH", `/pools/${id}`, input);
  }

  async deletePool(id: string): Promise<void> {
    await this.request<void>("DELETE", `/pools/${id}`);
  }

  listNodes(): Promise<NodeInfo[]> {
    return this.request<NodeInfo[]>("GET", "/nodes");
  }

  createNode(name: string): Promise<NodeCreated> {
    return this.request<NodeCreated>("POST", "/nodes", { name });
  }

  async deleteNode(id: string): Promise<void> {
    await this.request<void>("DELETE", `/nodes/${id}`);
  }

  listInterfaces(): Promise<InterfaceInfo[]> {
    return this.request<InterfaceInfo[]>("GET", "/interfaces");
  }

  createInterface(input: InterfaceInput): Promise<InterfaceInfo> {
    return this.request<InterfaceInfo>("POST", "/interfaces", input);
  }

  updateInterface(
    id: string,
    input: Partial<Omit<InterfaceInput, "group_id" | "node_id" | "name">> & { enabled?: boolean },
  ): Promise<InterfaceInfo> {
    return this.request<InterfaceInfo>("PATCH", `/interfaces/${id}`, input);
  }

  rotateInterface(id: string): Promise<InterfaceInfo> {
    return this.request<InterfaceInfo>("POST", `/interfaces/${id}/rotate`);
  }

  async deleteInterface(id: string): Promise<void> {
    await this.request<void>("DELETE", `/interfaces/${id}`);
  }

  listDevices(): Promise<Device[]> {
    return this.request<Device[]>("GET", "/devices");
  }

  getDevice(id: string): Promise<Device> {
    return this.request<Device>("GET", `/devices/${id}`);
  }

  createDevice(input: DeviceInput): Promise<Device> {
    return this.request<Device>("POST", "/devices", input);
  }

  updateDevice(id: string, input: DeviceUpdateInput): Promise<Device> {
    return this.request<Device>("PATCH", `/devices/${id}`, input);
  }

  async deleteDevice(id: string): Promise<void> {
    await this.request<void>("DELETE", `/devices/${id}`);
  }

  listProfiles(id: string): Promise<Profile[]> {
    return this.request<Profile[]>("GET", `/devices/${id}/profiles`);
  }

  getProfile(id: string, interfaceId: string): Promise<Profile> {
    return this.request<Profile>("GET", `/devices/${id}/profiles/${interfaceId}`);
  }

  deviceStats(id: string): Promise<DeviceStats> {
    return this.request<DeviceStats>("GET", `/devices/${id}/stats`);
  }

  listShares(id: string): Promise<ShareLink[]> {
    return this.request<ShareLink[]>("GET", `/devices/${id}/shares`);
  }

  createShare(
    id: string,
    interfaceId: string,
    format: ShareFormat,
    ttlSecs?: number,
  ): Promise<ShareLink> {
    return this.request<ShareLink>("POST", `/devices/${id}/shares`, {
      interface_id: interfaceId,
      format,
      ttl_secs: ttlSecs ?? null,
    });
  }

  async revokeShare(token: string): Promise<void> {
    await this.request<void>("DELETE", `/shares/${token}`);
  }

  overview(): Promise<Overview> {
    return this.request<Overview>("GET", "/stats/overview");
  }

  series(scope: string, id: string | null, from: number, to: number): Promise<StatsPoint[]> {
    const params = new URLSearchParams({
      scope,
      from: String(from),
      to: String(to),
    });
    if (id) params.set("id", id);
    return this.request<StatsPoint[]>("GET", `/stats/series?${params.toString()}`);
  }

  getSettings(): Promise<Settings> {
    return this.request<Settings>("GET", "/settings");
  }

  updateSettings(input: Partial<Settings>): Promise<Settings> {
    return this.request<Settings>("PUT", "/settings", input);
  }

  importConfig(input: ImportInput): Promise<ImportResult> {
    return this.request<ImportResult>("POST", "/import", input);
  }

  private async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    auth = true,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = this.tokens.access();
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status === 401 && auth && !retried) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(method, path, body, auth, true);
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const code = error?.error?.code ?? "http_error";
      const message = error?.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401) this.tokens.clear();
      throw new ApiError(response.status, code, message);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private tryRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = this.tokens.refresh();
    if (!refreshToken) return Promise.resolve(false);
    this.refreshing = this.refresh(refreshToken)
      .then(() => true)
      .catch(() => {
        this.tokens.clear();
        return false;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
