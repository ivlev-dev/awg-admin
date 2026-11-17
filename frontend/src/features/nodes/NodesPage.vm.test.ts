import { NodesPageVM } from "./NodesPage.vm";
import { createAppContainer } from "@/app/di";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultNodesService } from "@/application/nodes/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { NodeCreated } from "@/domain/nodes/types";
import type { AuthSession, NodeInfo, Role, User } from "@/domain/types";
import type { TokenStore } from "@/infrastructure/storage";

const ADMIN: User = {
  id: "u1",
  login: "admin",
  role: "admin",
  tariff_id: null,
  group_id: null,
  email: null,
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

function userOf(role: Role): User {
  return { ...ADMIN, id: `u-${role}`, login: role, role };
}

class MemoryTokenStore implements TokenStore {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  access(): string | null {
    return this.accessToken;
  }

  refresh(): string | null {
    return this.refreshToken;
  }

  set(access: string, refresh: string): void {
    this.accessToken = access;
    this.refreshToken = refresh;
  }

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }
}

function makeSession(current: User = ADMIN): Session {
  const authSession: AuthSession = {
    token: "access",
    refresh_token: "refresh",
    expires_in: 3600,
    user: current,
  };
  const auth: AuthRepository = {
    login: vi.fn(async () => authSession),
    refresh: vi.fn(async () => authSession),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => current),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
  const session = new Session(auth, new MemoryTokenStore());
  session.user = current;
  session.ready = true;
  return session;
}

function node(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: "n1",
    name: "node-1",
    status: "online",
    online: true,
    last_seen: null,
    version: null,
    interfaces: 0,
    ...overrides,
  };
}

class MemoryNodesRepository implements NodesRepository {
  private seq = 0;

  readonly items = new Map<string, NodeInfo>();

  listNodes = vi.fn(async (): Promise<NodeInfo[]> => [...this.items.values()]);

  createNode = vi.fn(async (name: string): Promise<NodeCreated> => {
    const id = `n${++this.seq}`;
    const createdAt = "2020-01-01T00:00:00Z";
    this.items.set(
      id,
      node({ id, name, status: "offline", online: false, last_seen: null, interfaces: 0 }),
    );
    return { node: { id, name, created_at: createdAt }, token: `token-${id}` };
  });

  deleteNode = vi.fn(async (id: string): Promise<void> => {
    this.items.delete(id);
  });
}

interface Harness {
  vm: NodesPageVM;
  repo: MemoryNodesRepository;
  session: Session;
  toasts: ToastStore;
}

function makeVm(current: User = ADMIN): Harness {
  const repo = new MemoryNodesRepository();
  const session = makeSession(current);
  const toasts = new ToastStore();
  return { vm: new NodesPageVM(new DefaultNodesService(repo), session, toasts), repo, session, toasts };
}

function submit(): Event {
  return new Event("submit", { cancelable: true });
}

describe("NodesPageVM", () => {
  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  it("loads and sorts online nodes first", async () => {
    const harness = makeVm();
    harness.repo.items.set("n1", node({ id: "n1", name: "b-node", online: false, status: "offline" }));
    harness.repo.items.set("n2", node({ id: "n2", name: "z-node" }));
    harness.repo.items.set("n3", node({ id: "n3", name: "a-node" }));

    await harness.vm.load();

    expect(harness.vm.nodes.map((item) => item.id)).toEqual(["n3", "n2", "n1"]);
    expect(harness.vm.online).toBe(2);
    expect(harness.vm.loading).toBe(false);
    expect(harness.vm.error).toBeNull();
  });

  it("reports a load error", async () => {
    const harness = makeVm();
    harness.repo.listNodes.mockRejectedValueOnce(new Error("unreachable"));

    await harness.vm.load();

    expect(harness.vm.error).toBe("unreachable");
    expect(harness.vm.loading).toBe(false);
  });

  it("creates a node and exposes its token", async () => {
    const harness = makeVm();
    await harness.vm.load();
    harness.vm.openCreate();
    harness.vm.name = " node-2 ";

    await harness.vm.submitCreate(submit());

    expect(harness.repo.createNode).toHaveBeenCalledWith("node-2");
    expect(harness.vm.createdNode?.token).toBe("token-n1");
    expect(harness.vm.createdNode?.node.name).toBe("node-2");
    expect(harness.vm.createOpen).toBe(false);
    expect(harness.vm.name).toBe("");
    expect(harness.vm.nodes).toHaveLength(1);
    expect(harness.toasts.items.some((item) => item.message === "Нода «node-2» создана")).toBe(true);
  });

  it("requires a node name", async () => {
    const harness = makeVm();
    harness.vm.openCreate();

    expect(harness.vm.canCreate).toBe(false);
    await harness.vm.submitCreate(submit());

    expect(harness.repo.createNode).not.toHaveBeenCalled();
  });

  it("shows a service error when creation fails", async () => {
    const harness = makeVm();
    harness.repo.createNode.mockRejectedValueOnce(new Error("duplicate"));
    harness.vm.openCreate();
    harness.vm.name = "node-2";

    await harness.vm.submitCreate(submit());

    expect(harness.vm.formError).toBe("duplicate");
    expect(harness.vm.busy).toBe(false);
    expect(harness.vm.createOpen).toBe(true);
  });

  it("copies the node token", async () => {
    const harness = makeVm();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    harness.vm.createdNode = {
      node: { id: "n1", name: "node-1", created_at: "2020-01-01T00:00:00Z" },
      token: "secret-token",
    };

    await harness.vm.copyToken();

    expect(writeText).toHaveBeenCalledWith("secret-token");
    expect(harness.vm.tokenCopied).toBe(true);
    expect(harness.toasts.items.some((item) => item.message === "Токен скопирован")).toBe(true);
  });

  it("deletes a confirmed node and reloads the list", async () => {
    const harness = makeVm();
    harness.repo.items.set("n1", node());
    await harness.vm.load();

    await harness.vm.remove(node());

    expect(harness.repo.deleteNode).toHaveBeenCalledWith("n1");
    expect(harness.vm.nodes).toEqual([]);
    expect(harness.toasts.items.some((item) => item.message === "Нода «node-1» удалена")).toBe(true);
  });

  it("does not delete without confirmation", async () => {
    const harness = makeVm();
    harness.repo.items.set("n1", node());
    await harness.vm.load();
    window.confirm = vi.fn(() => false);

    await harness.vm.remove(node());

    expect(harness.repo.deleteNode).not.toHaveBeenCalled();
    expect(harness.vm.nodes).toHaveLength(1);
  });

  it("reports a delete error", async () => {
    const harness = makeVm();
    harness.repo.items.set("n1", node());
    await harness.vm.load();
    harness.repo.deleteNode.mockRejectedValueOnce(new Error("node has interfaces"));

    await harness.vm.remove(node());

    expect(harness.toasts.items.some((item) => item.message === "node has interfaces")).toBe(true);
    expect(harness.vm.busy).toBe(false);
  });

  it("checks the admin role through the session", () => {
    expect(makeVm().vm.isAdmin).toBe(true);
    expect(makeVm(userOf("user")).vm.isAdmin).toBe(false);
  });

  it("formats the interfaces label", () => {
    const harness = makeVm();

    expect(harness.vm.interfacesLabel(node({ interfaces: 1 }))).toBe("1 интерфейс");
    expect(harness.vm.interfacesLabel(node({ interfaces: 3 }))).toBe("3 интерфейса");
    expect(harness.vm.interfacesLabel(node({ interfaces: 5 }))).toBe("5 интерфейсов");
    expect(harness.vm.lastSeen(null)).toBe("никогда");
  });

  it("is resolved by the DI container", async () => {
    const container = createAppContainer();
    const vm = await container.resolve(NodesPageVM);

    expect(vm).toBeInstanceOf(NodesPageVM);
  });
});
