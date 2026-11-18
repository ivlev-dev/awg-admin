import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { DefaultImportService } from "@/application/import/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultUsersService } from "@/application/users/service";
import type { ImportRepository } from "@/domain/import/repository";
import type { InterfacesRepository } from "@/domain/interfaces/repository";
import type {
  ClientsApplyResult,
  ClientsPreview,
  ImportApplyResult,
  ImportPreview,
} from "@/domain/import/types";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { UsersRepository } from "@/domain/users/repository";
import type { InterfaceInfo, NodeInfo, User } from "@/domain/types";
import { ImportVM } from "@/features/import/ImportPage.vm";
import { ImportPage } from "@/features/import/ImportPage";

const NODES: NodeInfo[] = [
  {
    id: "n1",
    name: "node-1",
    status: "offline",
    online: false,
    last_seen: null,
    version: null,
    interfaces: 0,
  },
  {
    id: "n2",
    name: "node-2",
    status: "online",
    online: true,
    last_seen: "2020-01-01T00:00:00Z",
    version: "1.0.0",
    interfaces: 1,
  },
];

const OWNER: User = {
  id: "u1",
  login: "admin",
  email: "admin@example.com",
  status: "active",
  totp_enabled: false,
  role: "admin",
  tariff_id: null,
  group_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const INTERFACE: InterfaceInfo = {
  id: "i1",
  group_id: "g1",
  group_name: "Main",
  node_id: "n2",
  node_name: "node-2",
  name: "awg0",
  label: "Office",
  endpoint_host: "vpn.example.com",
  endpoint_port: 51820,
  listen_port: 51820,
  mtu: 1280,
  public_key: "server-pub",
  obf: {
    h1: { lo: 1, hi: 2 },
    h2: { lo: 1, hi: 2 },
    h3: { lo: 1, hi: 2 },
    h4: { lo: 1, hi: 2 },
    s1: 1,
    s2: 2,
    s3: 3,
    s4: 4,
    header_protection_key: "key",
    random_trailers: false,
  },
  enabled: true,
  peers: 1,
};

const CLIENTS_PREVIEW: ClientsPreview = {
  interfaces: [
    {
      id: "i1",
      name: "awg0",
      group_id: "g1",
      group_name: "Main",
      node_id: "n2",
      public_key: "server-pub",
      clients: [
        {
          name: "client-1",
          status: "create",
          address: "10.8.0.2/24",
          reason: null,
          device_id: null,
          changes: [],
        },
        {
          name: "laptop",
          status: "update",
          address: "10.8.0.4/24",
          reason: null,
          device_id: "d4",
          changes: [
            { field: "address", from: "10.8.0.2/24", to: "10.8.0.4/24" },
            { field: "preshared_key", from: "old", to: "new" },
          ],
        },
      ],
      counts: { create: 1, unchanged: 0, update: 1, duplicate: 0, error: 0 },
    },
  ],
  summary: { create: 1, unchanged: 0, update: 1, duplicate: 0, error: 0, interfaces: 1 },
  warnings: [],
};

const CLIENTS_APPLIED: ClientsApplyResult = {
  ...CLIENTS_PREVIEW,
  created: { interfaces: [{ id: "i1", device_ids: ["d1"] }] },
};

const PREVIEW: ImportPreview = {
  group: { name: "Imported" },
  interfaces: [
    {
      index: 0,
      name: "awg0",
      public_key: "server-pub",
      clients: [
        {
          name: "client-1",
          status: "create",
          address: "10.8.0.2/24",
          reason: null,
          device_id: null,
          changes: [],
        },
      ],
      server_peers: [
        {
          public_key: "peer-aaaaaaaaaaaaaaaa",
          status: "create",
          address: "10.8.0.9/24",
          reason: null,
        },
        {
          public_key: "peer-bbbbbbbbbbbbbbbb",
          status: "duplicate",
          address: null,
          reason: "address is used",
        },
        {
          public_key: "peer-cccccccccccccccc",
          status: "error",
          address: null,
          reason: "invalid key",
        },
      ],
      counts: { create: 1, unchanged: 0, update: 0, duplicate: 0, error: 0 },
      server_peer_counts: { create: 1, duplicate: 1, error: 1 },
    },
  ],
  summary: {
    create: 1,
    unchanged: 0,
    update: 0,
    duplicate: 0,
    error: 0,
    interfaces: 1,
    external: { create: 1, duplicate: 1, error: 1 },
  },
  warnings: [],
};

const RESULT: ImportApplyResult = {
  ...PREVIEW,
  created: {
    group_id: "g1",
    interfaces: [{ id: "i1", name: "awg0", device_ids: ["d1"] }],
  },
};

function nodesRepository(): NodesRepository {
  return {
    listNodes: vi.fn(async () => NODES.map((node) => ({ ...node }))),
    createNode: vi.fn(async () => {
      throw new Error("createNode is not used in this test");
    }),
    rotateNode: vi.fn(async () => {
      throw new Error("rotateNode is not used in this test");
    }),
    deleteNode: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function usersRepository(): UsersRepository {
  return {
    listUsers: vi.fn(async () => [{ ...OWNER }]),
    listPending: vi.fn(async () => []),
    createUser: vi.fn(async () => {
      throw new Error("createUser is not used in this test");
    }),
    updateUser: vi.fn(async () => {
      throw new Error("updateUser is not used in this test");
    }),
    deleteUser: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    approveUser: vi.fn(async () => {
      throw new Error("approveUser is not used in this test");
    }),
    rejectUser: vi.fn(async () => {
      throw new Error("rejectUser is not used in this test");
    }),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function interfacesRepository(): InterfacesRepository {
  return {
    listInterfaces: vi.fn(async () => [{ ...INTERFACE }]),
    createInterface: vi.fn(async () => {
      throw new Error("createInterface is not used in this test");
    }),
    updateInterface: vi.fn(async () => {
      throw new Error("updateInterface is not used in this test");
    }),
    rotateInterface: vi.fn(async () => {
      throw new Error("rotateInterface is not used in this test");
    }),
    deleteInterface: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ done: 0, failed: [] })),
  };
}

function importRepository(): ImportRepository {
  return {
    preview: vi.fn(async () => PREVIEW),
    apply: vi.fn(async () => RESULT),
    previewClients: vi.fn(async () => CLIENTS_PREVIEW),
    applyClients: vi.fn(async () => CLIENTS_APPLIED),
    importConfig: vi.fn(async () => {
      throw new Error("importConfig is not used in this test");
    }),
  };
}

let captured: ImportVM | null = null;

function ImportProbe(this: { vm: ImportVM }) {
  captured = this.vm;
  return <div class="import-probe">{this.vm.nodes.length}</div>;
}

describe("ImportPageVM constructor DI", () => {
  afterEach(() => {
    captured = null;
  });

  it("монтируется через createComponent с внедрёнными сервисами", async () => {
    const nodes = nodesRepository();
    const users = usersRepository();
    const interfaces = interfacesRepository();
    const imports = importRepository();
    const router = new Router();
    const toasts = new ToastStore();
    const container = createAppContainer();
    container.bind(DefaultNodesService, () => new DefaultNodesService(nodes));
    container.bind(DefaultUsersService, () => new DefaultUsersService(users));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfaces));
    container.bind(DefaultImportService, () => new DefaultImportService(imports));
    container.bind(Router, () => router);
    container.bind(ToastStore, () => toasts);

    const result = createComponent(ImportProbe, {}, { container });
    await result.ready;

    expect(captured).toBeInstanceOf(ImportVM);
    await vi.waitFor(() => {
      const vm = captured;
      if (vm === null) throw new Error("VM не был смонтирован");
      expect(vm.nodes).toHaveLength(2);
    });

    const vm = captured;
    if (vm === null) throw new Error("VM не был смонтирован");
    expect(vm.nodeId).toBe("n2");
    expect(nodes.listNodes).toHaveBeenCalledTimes(1);
    expect(users.listUsers).toHaveBeenCalledTimes(1);

    vm.groupName = "Imported";
    vm.interfaces[0]!.serverConfig = "[Interface]\nPrivateKey = server-key";
    vm.interfaces[0]!.endpointHost = "vpn.example.com";
    vm.setClientsText(0, {
      target: { value: "[Interface]\nAddress = 10.8.0.2/24\n\n[Peer]\nPublicKey = peer-a" },
    } as unknown as Event);

    await vm.previewNow();
    await vm.applyNow();

    expect(imports.preview).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "n2", group_name: "Imported" }),
    );
    expect(imports.apply).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "n2", group_name: "Imported" }),
    );
    expect(vm.applied).toEqual(RESULT);
    expect(toasts.items.at(-1)).toMatchObject({ kind: "success" });

    result.dispose();
  });

  it("рендерит шаги мастера", async () => {
    const importRepositoryStub = importRepository();
    const container = createAppContainer();
    container.bind(DefaultNodesService, () => new DefaultNodesService(nodesRepository()));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersRepository()));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesRepository()));
    container.bind(DefaultImportService, () => new DefaultImportService(importRepositoryStub));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const result = createComponent(ImportPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("1. Группа и нода");
    });
    expect(document.body.textContent).toContain("Шаг 1 из 4");
    expect(document.body.textContent).toContain("Импорт конфигурации");

    await vi.waitFor(() => {
      const groupToolbar = document.querySelector(".list-toolbar");
      expect(groupToolbar?.querySelector("#import-node")).not.toBeNull();
      expect(groupToolbar?.querySelector("#import-owner")).not.toBeNull();
    });

    const nameInput = document.querySelector<HTMLInputElement>("#import-group-name");
    if (nameInput === null) throw new Error("group name input is missing");
    nameInput.value = "Imported";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const next = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Далее"),
    );
    if (next === undefined) throw new Error("next button is missing");
    await vi.waitFor(() => {
      expect((next as HTMLButtonElement).disabled).toBe(false);
    });
    next.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("2. Интерфейсы");
    });
    expect(document.body.textContent).toContain("Пулы CIDR");

    const clientsTab = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Клиенты в интерфейс"),
    );
    if (clientsTab === undefined) throw new Error("clients tab is missing");
    clientsTab.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Импорт клиентов в интерфейс");
    });
    expect(document.body.textContent).toContain("Определить автоматически");

    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });

  it("рисует серверные пиры без клиентов и diff клиентов", async () => {
    const container = createAppContainer();
    container.bind(DefaultNodesService, () => new DefaultNodesService(nodesRepository()));
    container.bind(DefaultUsersService, () => new DefaultUsersService(usersRepository()));
    container.bind(DefaultInterfacesService, () => new DefaultInterfacesService(interfacesRepository()));
    container.bind(DefaultImportService, () => new DefaultImportService(importRepository()));
    container.bind(Router, () => new Router());
    container.bind(ToastStore, () => new ToastStore());

    const vm = await container.resolve<ImportVM>(ImportVM);
    const result = createComponent(ImportPage, {}, { container });
    document.body.append(result.node);
    await result.ready;

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("1. Группа и нода");
    });

    vm.groupName = "Imported";
    vm.interfaces[0]!.serverConfig = "[Interface]\nPrivateKey = server-key";
    vm.interfaces[0]!.endpointHost = "vpn.example.com";
    await vm.previewNow();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Серверные пиры без клиентов");
      expect(document.body.textContent).toContain("peer-aaa…aaaa");
      expect(document.body.textContent).toContain("10.8.0.9/24");
      expect(document.body.textContent).toContain("Внешних к созданию");
    });

    vm.mode = "clients";
    vm.setClientsImportText({
      target: {
        value: "[Interface]\nAddress = 10.8.0.2/24\n\n[Peer]\nPublicKey = peer-a",
      },
    } as unknown as Event);
    await vm.previewClientsNow();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("К обновлению");
      expect(document.body.textContent).toContain("Показать изменения");
    });

    const toggle = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Показать изменения"),
    );
    if (toggle === undefined) throw new Error("changes toggle is missing");
    toggle.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("10.8.0.2/24 → 10.8.0.4/24");
      expect(document.body.textContent).toContain("••• → •••");
    });

    result.dispose();
    result.node.parentNode?.removeChild(result.node);
  });
});
