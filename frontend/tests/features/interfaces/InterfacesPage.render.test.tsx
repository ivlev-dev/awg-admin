import { createComponent, flushSync, whenIdle } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";

import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import type { AuthRepository } from "@/domain/auth/repository";
import type { BulkFailure, BulkResult } from "@/domain/bulk";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { InterfaceBulkAction } from "@/domain/interfaces/repository";
import type { InterfaceInput, InterfaceUpdateInput } from "@/domain/interfaces/types";
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type { CidrPool, Group, InterfaceInfo, NodeInfo, User } from "@/domain/types";
import { InterfacesPage } from "@/features/interfaces/InterfacesPage";
import { InterfacesPageVM } from "@/features/interfaces/InterfacesPage.vm";

const ADMIN: User = {
  id: "u1",
  full_name: null,
  role: "admin",
  tariff_id: null,
  group_id: null,
  email: "user@example.com",
  status: "active",
  totp_enabled: false,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const GROUP: Group = {
  id: "g1",
  name: "Офис",
  description: "",
  base_cidr: "10.8.0.0/16",
  forwarding_default: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  interfaces: 0,
  devices: 0,
};

const NODE: NodeInfo = {
  id: "n1",
  name: "node-1",
  status: "online",
  online: true,
  last_seen: null,
  version: null,
  interfaces: 0,
};

class MemoryTokenStore {
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

function authRepository(): AuthRepository {
  return {
    login: vi.fn(async () => {
      throw new Error("login is not used");
    }),
    register: vi.fn(async () => ({ status: "pending_email" as const })),
    verifyEmail: vi.fn(async () => ({ status: "pending_approval" as const })),
    resendVerification: vi.fn(async () => undefined),
    forgotPassword: vi.fn(async () => ({ status: "sent" as const })),
    resetPassword: vi.fn(async () => ({ status: "reset" as const })),
    refresh: vi.fn(async () => {
      throw new Error("refresh is not used");
    }),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => ADMIN),
    updateProfile: vi.fn(async () => ADMIN),
    changePassword: vi.fn(async () => undefined),
    totpSetup: vi.fn(async () => ({ secret: "", otpauth_url: "", recovery_codes: [] })),
    totpEnable: vi.fn(async () => ({ enabled: true })),
    totpDisable: vi.fn(async () => ({ enabled: false })),
    sessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logoutAll: vi.fn(async () => ({ ok: true, revoked: 0 })),
  };
}

class EmptyInterfacesRepository {
  listInterfaces = vi.fn(async (): Promise<InterfaceInfo[]> => []);
  createInterface = vi.fn(async (_input: InterfaceInput): Promise<InterfaceInfo> => {
    throw new Error("not implemented");
  });
  updateInterface = vi.fn(async (_id: string, _input: InterfaceUpdateInput): Promise<InterfaceInfo> => {
    throw new Error("not implemented");
  });
  rotateInterface = vi.fn(async (_id: string): Promise<InterfaceInfo> => {
    throw new Error("not implemented");
  });
  deleteInterface = vi.fn(async (_id: string): Promise<void> => undefined);
  bulk = vi.fn(async (_action: InterfaceBulkAction, _ids: readonly string[]): Promise<BulkResult> => ({
    done: 0,
    failed: [] as BulkFailure[],
  }));
}

class EmptyGroupsRepository {
  listGroups = vi.fn(async (): Promise<Group[]> => [GROUP]);
  createGroup = vi.fn(async (_input: GroupInput): Promise<Group> => {
    throw new Error("not implemented");
  });
  updateGroup = vi.fn(async (_id: string, _input: Partial<GroupInput>): Promise<Group> => {
    throw new Error("not implemented");
  });
  deleteGroup = vi.fn(async (_id: string): Promise<void> => undefined);
  listPools = vi.fn(async (_id: string): Promise<CidrPool[]> => []);
  createPool = vi.fn(async (_id: string, _input: PoolInput): Promise<CidrPool> => {
    throw new Error("not implemented");
  });
  updatePool = vi.fn(async (_id: string, _input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool> => {
    throw new Error("not implemented");
  });
  deletePool = vi.fn(async (_id: string): Promise<void> => undefined);
  bulk = vi.fn(async (): Promise<BulkResult> => ({ done: 0, failed: [] }));
}

class EmptyNodesRepository {
  listNodes = vi.fn(async (): Promise<NodeInfo[]> => [NODE]);
  createNode = vi.fn(async (_name: string): Promise<NodeCreated> => {
    throw new Error("not implemented");
  });
  rotateNode = vi.fn(async (_id: string): Promise<NodeRotated> => {
    throw new Error("not implemented");
  });
  deleteNode = vi.fn(async (_id: string): Promise<void> => undefined);
  bulk = vi.fn(async (): Promise<BulkResult> => ({ done: 0, failed: [] }));
}

function makeVm(): InterfacesPageVM {
  const session = new Session(authRepository(), new MemoryTokenStore());
  session.user = ADMIN;
  session.ready = true;
  return new InterfacesPageVM(
    new DefaultInterfacesService(new EmptyInterfacesRepository()),
    new DefaultGroupsService(new EmptyGroupsRepository()),
    new DefaultNodesService(new EmptyNodesRepository()),
    session,
    new ToastStore(),
  );
}

describe("InterfacesPage groups filter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("скрывает фильтр группы и оставляет фильтр ноды", async () => {
    const vm = makeVm();
    const container = new Container("interfaces-page-render");
    container.bindValue(InterfacesPageVM, vm);

    const result = createComponent(InterfacesPage, {}, { container });
    await result.ready;
    document.body.appendChild(result.node);
    flushSync();
    await whenIdle();

    await vi.waitFor(() => {
      expect(document.querySelector("#iface-node")).not.toBeNull();
    });
    expect(document.querySelector("#iface-group")).toBeNull();
    expect(document.querySelector("input[type='search']")).not.toBeNull();

    result.dispose();
  });
});
