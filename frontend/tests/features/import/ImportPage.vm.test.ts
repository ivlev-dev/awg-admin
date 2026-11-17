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
  ImportInput,
  ImportPreview,
} from "@/domain/import/types";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { UsersRepository } from "@/domain/users/repository";
import type { ImportResult, InterfaceInfo, NodeInfo, User } from "@/domain/types";
import { ImportVM } from "@/features/import/ImportPage.vm";

const NODE_OFFLINE: NodeInfo = {
  id: "n1",
  name: "node-1",
  status: "offline",
  online: false,
  last_seen: null,
  version: null,
  interfaces: 0,
};

const NODE_ONLINE: NodeInfo = {
  id: "n2",
  name: "node-2",
  status: "online",
  online: true,
  last_seen: "2020-01-01T00:00:00Z",
  version: "1.0.0",
  interfaces: 1,
};

const OWNER: User = {
  id: "u1",
  login: "owner",
  email: "owner@example.com",
  status: "active",
  totp_enabled: false,
  role: "user",
  tariff_id: null,
  group_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const SERVER_CONFIG = "[Interface]\nPrivateKey = server-key\nListenPort = 51820";

const CLIENT_ONE = `[Interface]
Address = 10.8.0.2/24
PrivateKey = client-a

[Peer]
PublicKey = peer-a`;

const CLIENT_TWO = `[Interface]
Address = 10.8.0.3/24
PrivateKey = client-b

[Peer]
PublicKey = peer-b`;

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
        {
          name: "client-2",
          status: "duplicate",
          address: "10.8.0.3/24",
          reason: "address is used",
          device_id: null,
          changes: [],
        },
        {
          name: "client-3",
          status: "error",
          address: null,
          reason: "invalid key",
          device_id: null,
          changes: [],
        },
      ],
      server_peers: [],
      counts: { create: 1, unchanged: 0, update: 0, duplicate: 1, error: 1 },
      server_peer_counts: { create: 0, duplicate: 0, error: 0 },
    },
  ],
  summary: {
    create: 1,
    unchanged: 0,
    update: 0,
    duplicate: 1,
    error: 1,
    interfaces: 1,
    external: { create: 0, duplicate: 0, error: 0 },
  },
  warnings: ["public key check"],
};

const APPLY: ImportApplyResult = {
  ...PREVIEW,
  created: {
    group_id: "g1",
    interfaces: [{ id: "i1", name: "awg0", device_ids: ["d1", "d2"] }],
  },
};

const EXISTING_INTERFACE: InterfaceInfo = {
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
  peers: 2,
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
          name: "client-2",
          status: "error",
          address: null,
          reason: "interface not found",
          device_id: null,
          changes: [],
        },
      ],
      counts: { create: 1, unchanged: 0, update: 0, duplicate: 0, error: 1 },
    },
  ],
  summary: {
    create: 1,
    unchanged: 0,
    update: 0,
    duplicate: 0,
    error: 1,
    interfaces: 1,
  },
  warnings: ["auto match"],
};

const EXTERNAL_PREVIEW: ImportPreview = {
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

const EXTERNAL_APPLIED: ImportApplyResult = {
  ...EXTERNAL_PREVIEW,
  created: {
    group_id: "g1",
    interfaces: [{ id: "i1", name: "awg0", device_ids: ["d1", "d2"] }],
  },
};

const CLIENTS_DIFF_PREVIEW: ClientsPreview = {
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
          name: "phone",
          status: "unchanged",
          address: "10.8.0.3/24",
          reason: null,
          device_id: "d3",
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
            { field: "preshared_key", from: "old-psk", to: "new-psk" },
            { field: "name", from: "old-name", to: "laptop" },
          ],
        },
      ],
      counts: { create: 0, unchanged: 1, update: 1, duplicate: 0, error: 0 },
    },
  ],
  summary: {
    create: 0,
    unchanged: 1,
    update: 1,
    duplicate: 0,
    error: 0,
    interfaces: 1,
  },
  warnings: [],
};

const CLIENTS_DIFF_APPLIED: ClientsApplyResult = {
  ...CLIENTS_DIFF_PREVIEW,
  created: { interfaces: [{ id: "i1", device_ids: ["d4"] }] },
};

const CLIENTS_APPLIED: ClientsApplyResult = {
  ...CLIENTS_PREVIEW,
  created: { interfaces: [{ id: "i1", device_ids: ["d1"] }] },
};

const LEGACY_RESULT: ImportResult = {
  group_id: "g1",
  interface_id: "i1",
  imported_devices: 1,
  failed_devices: [],
};

function nodesHarness(nodes: NodeInfo[]): {
  repository: NodesRepository;
  listNodes: ReturnType<typeof vi.fn>;
} {
  const listNodes = vi.fn(async () => nodes.map((node) => ({ ...node })));
  return {
    listNodes,
    repository: {
      listNodes,
      createNode: vi.fn(async () => {
        throw new Error("createNode is not used in this test");
      }),
      rotateNode: vi.fn(async () => {
        throw new Error("rotateNode is not used in this test");
      }),
      deleteNode: vi.fn(async () => undefined),
    },
  };
}

function usersHarness(users: User[]): {
  repository: UsersRepository;
  listUsers: ReturnType<typeof vi.fn>;
} {
  const listUsers = vi.fn(async () => users.map((user) => ({ ...user })));
  return {
    listUsers,
    repository: {
      listUsers,
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
    },
  };
}

function interfacesHarness(items: InterfaceInfo[]): {
  repository: InterfacesRepository;
  listInterfaces: ReturnType<typeof vi.fn>;
} {
  const listInterfaces = vi.fn(async () => items.map((item) => ({ ...item })));
  return {
    listInterfaces,
    repository: {
      listInterfaces,
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
    },
  };
}

function importHarness(
  result: ImportPreview = PREVIEW,
  applied: ImportApplyResult = APPLY,
  clientsPreview: ClientsPreview = CLIENTS_PREVIEW,
  clientsApplied: ClientsApplyResult = CLIENTS_APPLIED,
): {
  repository: ImportRepository;
  preview: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
  previewClients: ReturnType<typeof vi.fn>;
  applyClients: ReturnType<typeof vi.fn>;
  importConfig: ReturnType<typeof vi.fn>;
} {
  const preview = vi.fn(async (_input: ImportInput) => result);
  const apply = vi.fn(async (_input: ImportInput) => applied);
  const previewClients = vi.fn(async () => clientsPreview);
  const applyClients = vi.fn(async () => clientsApplied);
  const importConfig = vi.fn(async () => LEGACY_RESULT);
  return {
    preview,
    apply,
    previewClients,
    applyClients,
    importConfig,
    repository: { preview, apply, previewClients, applyClients, importConfig },
  };
}

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

function fileEvent(files: File[]): Event {
  return { target: { files, value: "config.conf" } } as unknown as Event;
}

function setup(
  nodeList: NodeInfo[] = [NODE_OFFLINE, NODE_ONLINE],
  userList: User[] = [OWNER],
  interfaceList: InterfaceInfo[] = [EXISTING_INTERFACE],
) {
  const nodes = nodesHarness(nodeList);
  const users = usersHarness(userList);
  const interfaces = interfacesHarness(interfaceList);
  const imports = importHarness();
  window.history.replaceState(null, "", "/import");
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new ImportVM(
    new DefaultImportService(imports.repository),
    new DefaultNodesService(nodes.repository),
    new DefaultUsersService(users.repository),
    new DefaultInterfacesService(interfaces.repository),
    router,
    toasts,
  );
  return { vm, nodes, users, interfaces, imports, router, toasts };
}

function fillInterface(
  vm: ImportVM,
  index: number,
  options: { clientsText?: string; endpointHost?: string } = {},
): void {
  const draft = vm.interfaces[index];
  if (!draft) throw new Error(`interface ${index} is missing`);
  draft.serverConfig = SERVER_CONFIG;
  draft.endpointHost = options.endpointHost ?? "vpn.example.com";
  if (options.clientsText !== undefined) {
    draft.clientsText = options.clientsText;
    vm.parseClients(index, false);
  }
}

function fillValid(vm: ImportVM): void {
  vm.groupName = "Imported";
  vm.groupDescription = "  ";
  fillInterface(vm, 0, { clientsText: `${CLIENT_ONE}\n---\n${CLIENT_TWO}` });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ImportPageVM", () => {
  it("загружает ноды и владельцев, выбирает онлайн-ноду", async () => {
    const { vm, nodes, users, interfaces } = setup();

    await vm.created();

    expect(nodes.listNodes).toHaveBeenCalledTimes(1);
    expect(users.listUsers).toHaveBeenCalledTimes(1);
    expect(interfaces.listInterfaces).toHaveBeenCalledTimes(1);
    expect(vm.nodes).toEqual([NODE_OFFLINE, NODE_ONLINE]);
    expect(vm.owners).toEqual([OWNER]);
    expect(vm.interfaceList).toEqual([EXISTING_INTERFACE]);
    expect(vm.nodesLoading).toBe(false);
    expect(vm.ownersLoading).toBe(false);
    expect(vm.interfacesLoading).toBe(false);
    expect(vm.nodeId).toBe(NODE_ONLINE.id);
    expect(vm.nodesError).toBeNull();
    expect(vm.ownersError).toBeNull();
    expect(vm.interfacesError).toBeNull();
    expect(vm.ownerOptions.map((option) => option.value)).toEqual(["", OWNER.id]);
    expect(vm.interfaceOptions.map((option) => option.value)).toEqual(["", EXISTING_INTERFACE.id]);
  });

  it("выбирает первую ноду, если онлайн-нод нет", async () => {
    const { vm } = setup([NODE_OFFLINE]);

    await vm.created();

    expect(vm.nodeId).toBe(NODE_OFFLINE.id);
  });

  it("показывает ошибки загрузки нод и владельцев", async () => {
    const { vm, nodes, users, toasts } = setup();
    vi.mocked(nodes.listNodes).mockRejectedValueOnce(new Error("Ноды недоступны"));
    vi.mocked(users.listUsers).mockRejectedValueOnce(new Error("Пользователи недоступны"));

    await vm.loadNodes();
    await vm.loadOwners();

    expect(vm.nodesError).toBe("Ноды недоступны");
    expect(vm.ownersError).toBe("Пользователи недоступны");
    expect(vm.nodes).toEqual([]);
    expect(vm.owners).toEqual([]);
    expect(toasts.items.map((item) => item.message)).toContain("Ноды недоступны");
    expect(toasts.items.map((item) => item.message)).toContain("Пользователи недоступны");
  });

  it("разбирает клиентов в нескольких интерфейсах", async () => {
    const { vm, toasts } = setup();
    await vm.created();
    fillValid(vm);
    vm.addInterface();

    expect(vm.interfaces).toHaveLength(2);
    expect(vm.interfaces[1]?.name).toBe("awg1");
    fillInterface(vm, 1, { clientsText: CLIENT_TWO });

    expect(vm.interfaces[0]?.clients.map((client) => client.name)).toEqual([
      "client-1",
      "client-2",
    ]);
    expect(vm.interfaces[1]?.clients.map((client) => client.name)).toEqual(["client-1"]);
    expect(vm.totalClients).toBe(3);
    vm.parseClients(1);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Разобрано конфигов: 1",
    });
  });

  it("не разбирает пустой текст клиентских конфигов", () => {
    const { vm, toasts } = setup();

    expect(vm.parseClients(0)).toBe(0);
    expect(vm.interfaces[0]?.clients).toEqual([]);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Вставьте клиентские конфиги",
    });
  });

  it("синхронизирует текст при вводе и удалении клиентов", () => {
    const { vm } = setup();

    vm.setClientsText(0, inputEvent(`${CLIENT_ONE}\n---\n${CLIENT_TWO}`));

    expect(vm.interfaces[0]?.clients).toHaveLength(2);
    expect(vm.interfaces[0]?.clients[0]?.config).toBe(CLIENT_ONE);

    vm.removeClient(0, 0);

    expect(vm.interfaces[0]?.clients).toHaveLength(1);
    expect(vm.interfaces[0]?.clientsText).toBe(CLIENT_TWO);
  });

  it("берёт имена клиентов из имён файлов", async () => {
    const { vm, toasts } = setup();

    await vm.setClientFiles(0, fileEvent([
      new File([CLIENT_ONE], "laptop.conf", { type: "text/plain" }),
      new File([CLIENT_TWO], "laptop.conf", { type: "text/plain" }),
    ]));

    expect(vm.interfaces[0]?.clients.map((client) => client.name)).toEqual(["laptop", "laptop-2"]);
    expect(vm.interfaces[0]?.clientsText).toContain(CLIENT_ONE);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Загружено конфигов: 2",
    });
  });

  it("загружает серверный конфиг из файла", async () => {
    const { vm, toasts } = setup();

    await vm.setInterfaceServerFile(0, fileEvent([new File([SERVER_CONFIG], "server.conf")]));

    expect(vm.interfaces[0]?.serverConfig).toBe(SERVER_CONFIG);
    expect(vm.serverConfigValid(0)).toBe(true);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Загружен серверный конфиг server.conf",
    });
  });

  it("извлекает адрес, ключ пира и превью конфига", () => {
    const { vm } = setup();

    expect(vm.clientAddress(CLIENT_ONE)).toBe("10.8.0.2/24");
    expect(vm.clientPeerKey(CLIENT_ONE)).toBe("peer-a");
    expect(vm.clientPeerKey("[Interface]\nPrivateKey = x")).toBeNull();
    expect(vm.clientAddress("[Interface]\nPrivateKey = x")).toBe("—");
    expect(vm.clientPreview(CLIENT_ONE).split("\n")).toHaveLength(6);
  });

  it("проверяет совпадение ключей пиров по интерфейсам", () => {
    const { vm } = setup();

    vm.interfaces[0]!.clients = [
      { name: "a", config: CLIENT_ONE },
      { name: "b", config: CLIENT_TWO },
    ];
    expect(vm.clientKeysMismatch(0)).toBe(true);
    expect(vm.clientsWithoutKey(0)).toBe(0);

    vm.interfaces[0]!.clients = [
      { name: "a", config: CLIENT_ONE },
      { name: "b", config: "[Interface]\nAddress = 10.0.0.2/24" },
    ];
    expect(vm.clientKeysMismatch(0)).toBe(false);
    expect(vm.clientsWithoutKey(0)).toBe(1);
  });

  it("валидирует серверный конфиг, порты, MTU и CIDR", async () => {
    const { vm } = setup();
    await vm.created();

    expect(vm.serverConfigValid(0)).toBe(false);
    expect(vm.serverConfigWarning(0)).toBeNull();

    vm.interfaces[0]!.serverConfig = "PrivateKey = only";
    expect(vm.serverConfigWarning(0)).toBe("В конфиге не найден блок [Interface] с PrivateKey.");

    vm.interfaces[0]!.serverConfig = SERVER_CONFIG;
    vm.interfaces[0]!.endpointHost = "vpn.example.com";
    vm.interfaces[0]!.endpointPort = 0;
    vm.interfaces[0]!.listenPort = 70_000;
    vm.interfaces[0]!.mtu = 100;
    vm.groupName = "Imported";

    const messages = vm.interfaceIssues(0).map((issue) => vm.issueMessage(issue));
    expect(messages).toContain("Порт должен быть от 1 до 65535");
    expect(messages).toContain("MTU должен быть от 576 до 9000");

    vm.baseCidr = "bad";
    expect(vm.baseCidrError).toBe("Некорректный CIDR");
    expect(vm.groupValid).toBe(false);
  });

  it("валидирует дубли имён интерфейсов и пулов", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);
    vm.addInterface();
    fillInterface(vm, 1);

    vm.interfaces[1]!.name = "awg0";
    expect(vm.issueMessage(vm.interfaceIssues(1)[0]!)).toBe(
      "Имя интерфейса повторяется: awg0",
    );

    vm.interfaces[1]!.name = "awg1";
    vm.interfaces[0]!.pools = [
      { name: "default", cidr: "10.8.0.0/25", mode: "auto", gateway: "" },
      { name: "default", cidr: "10.8.0.128/25", mode: "auto", gateway: "" },
    ];

    const messages = vm.interfaceIssues(0).map((issue) => vm.issueMessage(issue));
    expect(messages).toContain("Имя пула повторяется: default");
    expect(vm.poolError(0, 1)).toBe("Имя пула повторяется: default");
  });

  it("валидирует пересечение пулов и выход за base CIDR", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);

    vm.interfaces[0]!.pools = [
      { name: "a", cidr: "10.8.0.0/24", mode: "auto", gateway: "" },
      { name: "b", cidr: "10.8.0.128/25", mode: "auto", gateway: "" },
    ];
    expect(vm.poolError(0, 0)).toBe("Пулы пересекаются: a и b");
    expect(vm.poolError(0, 1)).toBe("Пулы пересекаются: a и b");

    vm.interfaces[0]!.pools = [
      { name: "a", cidr: "192.168.0.0/24", mode: "auto", gateway: "" },
    ];
    expect(vm.poolError(0, 0)).toBe("Пул должен входить в base CIDR");
    expect(vm.valid).toBe(false);
  });

  it("проверяет черновик и показывает статусы клиентов", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);

    expect(vm.valid).toBe(true);
    expect(vm.canPreview).toBe(true);

    await vm.previewNow();

    expect(imports.preview).toHaveBeenCalledTimes(1);
    expect(imports.preview).toHaveBeenCalledWith({
      node_id: NODE_ONLINE.id,
      group_name: "Imported",
      group_description: "",
      base_cidr: "10.8.0.0/24",
      owner_user_id: null,
      interfaces: [
        {
          server_config: SERVER_CONFIG,
          name: "awg0",
          label: "",
          endpoint_host: "vpn.example.com",
          endpoint_port: 51820,
          listen_port: 51820,
          mtu: 1280,
          pools: [{ name: "default", cidr: "10.8.0.0/24", mode: "auto", gateway: null }],
          clients: [
            { name: "client-1", config: CLIENT_ONE },
            { name: "client-2", config: CLIENT_TWO },
          ],
        },
      ],
    });
    expect(vm.step).toBe(3);
    expect(vm.preview).toEqual(PREVIEW);
    expect(vm.previewSummary).toEqual(PREVIEW.summary);
    expect(vm.previewStatusLabel("create")).toBe("создать");
    expect(vm.previewStatusLabel("duplicate")).toBe("дубликат");
    expect(vm.previewStatusLabel("error")).toBe("ошибка");
    expect(vm.previewStatusClass("error")).toBe("badge badge--red");
    expect(vm.previewClientAddress(PREVIEW.interfaces[0]!.clients[2]!)).toBe("—");
    expect(vm.previewClientReason(PREVIEW.interfaces[0]!.clients[2]!)).toBe("invalid key");
    expect(vm.previewWarnings).toEqual(["public key check"]);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Проверка завершена: создать 1, дубликатов 1, ошибок 1",
    });
  });

  it("не проверяет невалидную форму", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();

    await vm.previewNow();

    expect(imports.preview).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Заполните обязательные поля",
    });
  });

  it("сбрасывает план проверки при изменении формы", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);
    await vm.previewNow();

    expect(vm.preview).not.toBeNull();
    expect(vm.step).toBe(3);

    vm.setGroupName(inputEvent("Renamed"));

    expect(vm.preview).toBeNull();
    expect(vm.canApply).toBe(false);
    expect(vm.step).toBe(2);
    expect(vm.planInvalidated).toBe(true);
  });

  it("не применяет импорт без проверки", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);

    await vm.applyNow();

    expect(imports.apply).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сначала выполните проверку",
    });
  });

  it("применяет импорт после проверки и показывает результат", async () => {
    const { vm, imports, router } = setup();
    await vm.created();
    fillValid(vm);
    await vm.previewNow();

    await vm.applyNow();

    expect(imports.apply).toHaveBeenCalledTimes(1);
    expect(vm.applied).toEqual(APPLY);
    expect(vm.step).toBe(4);
    expect(vm.applying).toBe(false);
    expect(vm.applyError).toBeNull();
    expect(vm.resultGroupId).toBe("g1");
    expect(vm.resultGroupPath).toBe("/groups/g1");
    expect(vm.resultInterfaceCount).toBe(1);
    expect(vm.resultDeviceCount).toBe(2);
    expect(vm.resultCreatedCount).toBe(1);
    expect(vm.resultDuplicateCount).toBe(1);
    expect(vm.resultErrorCount).toBe(1);
    expect(vm.resultFailures).toEqual([
      { interfaceName: "awg0", clientName: "client-3", reason: "invalid key" },
    ]);

    vm.openGroup();
    expect(router.path).toBe("/groups/g1");

    vm.openInterfaces();
    expect(router.path).toBe("/interfaces");
  });

  it("показывает нулевые счётчики external без серверных пиров", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);
    await vm.previewNow();

    expect(vm.previewHasExternal).toBe(false);
    expect(vm.previewExternalCounts).toEqual({ create: 0, duplicate: 0, error: 0 });
    expect(vm.previewInterfaces[0]?.server_peers).toEqual([]);
    expect(vm.resultExternalCount).toBe(0);
  });

  it("показывает серверные пиры без клиентов и счётчики external", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);
    vi.mocked(imports.preview).mockResolvedValueOnce(EXTERNAL_PREVIEW);
    vi.mocked(imports.apply).mockResolvedValueOnce(EXTERNAL_APPLIED);

    await vm.previewNow();

    expect(vm.previewHasExternal).toBe(true);
    expect(vm.previewExternalCounts).toEqual({ create: 1, duplicate: 1, error: 1 });
    expect(vm.previewSummary?.external).toEqual({ create: 1, duplicate: 1, error: 1 });
    const peers = vm.previewInterfaces[0]?.server_peers ?? [];
    expect(peers.map((peer) => peer.status)).toEqual(["create", "duplicate", "error"]);
    expect(vm.shortKey(peers[0]?.public_key ?? "")).toBe("peer-aaa…aaaa");
    expect(vm.shortKey("short-key")).toBe("short-key");
    expect(vm.serverPeerStatusLabel("create")).toBe("создать");
    expect(vm.serverPeerStatusLabel("duplicate")).toBe("дубликат");
    expect(vm.serverPeerStatusLabel("error")).toBe("ошибка");
    expect(vm.serverPeerStatusClass("create")).toBe("badge badge--green");
    expect(vm.serverPeerStatusClass("duplicate")).toBe("badge badge--amber");
    expect(vm.serverPeerStatusClass("error")).toBe("badge badge--red");
    expect(vm.serverPeerAddress(peers[0]!)).toBe("10.8.0.9/24");
    expect(vm.serverPeerAddress(peers[1]!)).toBe("—");
    expect(vm.serverPeerReason(peers[2]!)).toBe("invalid key");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Проверка завершена: создать 1, дубликатов 0, ошибок 0, внешних 1",
    });

    await vm.applyNow();

    expect(vm.resultExternalCount).toBe(1);
    expect(vm.resultDeviceCount).toBe(2);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Импортировано устройств: 1, внешних: 1",
    });
  });

  it("показывает diff unchanged/update и применяет обновления", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    vm.setClientsImportText(inputEvent(CLIENT_ONE));
    vi.mocked(imports.previewClients).mockResolvedValueOnce(CLIENTS_DIFF_PREVIEW);
    vi.mocked(imports.applyClients).mockResolvedValueOnce(CLIENTS_DIFF_APPLIED);

    await vm.previewClientsNow();

    expect(vm.clientsPreviewSummary).toEqual({
      create: 0,
      unchanged: 1,
      update: 1,
      duplicate: 0,
      error: 0,
      interfaces: 1,
    });
    expect(vm.previewStatusLabel("unchanged")).toBe("без изменений");
    expect(vm.previewStatusLabel("update")).toBe("обновить");
    expect(vm.previewStatusClass("unchanged")).toBe("badge badge--gray");
    expect(vm.previewStatusClass("update")).toBe("badge badge--blue");
    expect(vm.clientsPreviewInterfaces[0]?.counts).toEqual({
      create: 0,
      unchanged: 1,
      update: 1,
      duplicate: 0,
      error: 0,
    });
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message:
        "Проверка завершена: создать 0, обновить 1, без изменений 1, дубликатов 0, ошибок 0",
    });

    const iface = vm.clientsPreviewInterfaces[0];
    const client = iface?.clients[1];
    if (iface === undefined || client === undefined) throw new Error("update client is missing");
    const key = vm.changesKey(iface.id, client);

    expect(vm.changesOpen(key)).toBe(false);
    vm.toggleChanges(key);
    expect(vm.changesOpen(key)).toBe(true);
    expect(vm.clientChangeLabel("address")).toBe("Адрес");
    expect(vm.clientChangeLabel("preshared_key")).toBe("Preshared key");
    expect(vm.clientChangeLabel("name")).toBe("Имя");
    expect(vm.clientChangeText(client.changes[0]!)).toBe("10.8.0.2/24 → 10.8.0.4/24");
    expect(vm.clientChangeText(client.changes[1]!)).toBe("••• → •••");
    expect(vm.clientChangeText(client.changes[2]!)).toBe("old-name → laptop");
    vm.toggleChanges(key);
    expect(vm.changesOpen(key)).toBe(false);

    await vm.applyClientsNow();

    expect(vm.clientsResultCreatedCount).toBe(0);
    expect(vm.clientsResultUpdatedCount).toBe(1);
    expect(vm.clientsResultUnchangedCount).toBe(1);
    expect(vm.clientsResultErrorCount).toBe(0);
    expect(vm.clientsResultFailures).toEqual([]);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Импортировано устройств: 0, обновлено: 1",
    });
  });

  it("показывает фатальную ошибку применения и откат", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);
    await vm.previewNow();
    vi.mocked(imports.apply).mockRejectedValueOnce(new Error("Сбой транзакции"));

    await vm.applyNow();

    expect(vm.applying).toBe(false);
    expect(vm.applied).toBeNull();
    expect(vm.applyError).toBe("Сбой транзакции");
    expect(vm.step).toBe(3);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сбой транзакции",
    });
  });

  it("показывает ошибку проверки и сбрасывает состояние загрузки", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);
    vi.mocked(imports.preview).mockRejectedValueOnce(new Error("Некорректный конфиг сервера"));

    await vm.previewNow();

    expect(vm.previewing).toBe(false);
    expect(vm.preview).toBeNull();
    expect(vm.previewError).toBe("Некорректный конфиг сервера");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Некорректный конфиг сервера",
    });
  });

  it("отбрасывает устаревшую проверку, если форма изменилась", async () => {
    const { vm, imports } = setup();
    await vm.created();
    fillValid(vm);
    const pending = deferred<ImportPreview>();
    vi.mocked(imports.preview).mockReturnValueOnce(pending.promise);

    const request = vm.previewNow();
    vm.setGroupName(inputEvent("Changed"));
    pending.resolve(PREVIEW);
    await request;

    expect(vm.preview).toBeNull();
    expect(vm.step).toBe(2);
  });

  it("не отправляет запрос повторно во время проверки", async () => {
    const { vm, imports } = setup();
    await vm.created();
    fillValid(vm);
    vm.previewing = true;

    await vm.previewNow();
    await vm.applyNow();

    expect(imports.preview).not.toHaveBeenCalled();
    expect(imports.apply).not.toHaveBeenCalled();
  });

  it("управляет шагами мастера", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);

    vm.goToStep(2);
    expect(vm.step).toBe(2);

    vm.goToStep(4);
    expect(vm.step).toBe(2);

    await vm.previewNow();
    expect(vm.step).toBe(3);

    vm.goToStep(1);
    expect(vm.step).toBe(1);
    vm.goToStep(2);
    expect(vm.step).toBe(2);
    vm.goToStep(3);
    expect(vm.step).toBe(3);

    vm.back();
    expect(vm.step).toBe(2);

    vm.next();
    await vi.waitFor(() => {
      expect(vm.preview).not.toBeNull();
    });
    expect(vm.step).toBe(3);

    vm.next();
    await vi.waitFor(() => {
      expect(vm.step).toBe(4);
    });
  });

  it("сбрасывает форму и сохраняет выбранную ноду", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);
    vm.addInterface();
    vm.ownerUserId = OWNER.id;
    await vm.previewNow();

    vm.reset();

    expect(vm.step).toBe(1);
    expect(vm.groupName).toBe("");
    expect(vm.groupDescription).toBe("");
    expect(vm.baseCidr).toBe("10.8.0.0/24");
    expect(vm.ownerUserId).toBe("");
    expect(vm.interfaces).toHaveLength(1);
    expect(vm.interfaces[0]?.name).toBe("awg0");
    expect(vm.interfaces[0]?.serverConfig).toBe("");
    expect(vm.interfaces[0]?.clients).toEqual([]);
    expect(vm.interfaces[0]?.clientsText).toBe("");
    expect(vm.preview).toBeNull();
    expect(vm.applied).toBeNull();
    expect(vm.previewError).toBeNull();
    expect(vm.applyError).toBeNull();
    expect(vm.nodeId).toBe(NODE_ONLINE.id);
  });

  it("проверяет пулы и параметры интерфейса", async () => {
    const { vm } = setup();
    await vm.created();

    vm.setPoolCidr(0, 0, inputEvent("10.8.0.0/25"));
    vm.addPool(0);
    expect(vm.interfaces[0]?.pools).toHaveLength(2);
    expect(vm.interfaces[0]?.pools[1]?.name).toBe("pool-2");
    expect(vm.poolError(0, 1)).toBe("Пулы пересекаются: default и pool-2");

    vm.setPoolCidr(0, 1, inputEvent("10.8.0.128/25"));
    expect(vm.poolError(0, 1)).toBeNull();

    vm.setPoolCidr(0, 1, inputEvent("192.168.0.0/24"));
    expect(vm.poolError(0, 1)).toBe("Пул должен входить в base CIDR");
    expect(vm.valid).toBe(false);

    vm.removePool(0, 1);
    expect(vm.interfaces[0]?.pools).toHaveLength(1);

    vm.removeInterface(0);
    expect(vm.interfaces).toHaveLength(1);
  });

  it("переключает режимы импорта", () => {
    const { vm } = setup();

    expect(vm.mode).toBe("group");
    vm.setMode("clients");
    expect(vm.mode).toBe("clients");
    vm.setMode("unknown");
    expect(vm.mode).toBe("clients");
    vm.setMode("group");
    expect(vm.mode).toBe("group");
  });

  it("разбирает клиентов для импорта в интерфейс", () => {
    const { vm, toasts } = setup();

    vm.setClientsImportText(inputEvent(`${CLIENT_ONE}\n---\n${CLIENT_TWO}`));
    expect(vm.clientsImport.map((client) => client.name)).toEqual(["client-1", "client-2"]);
    expect(vm.clientsTotal).toBe(2);
    expect(vm.clientsValid).toBe(true);

    expect(vm.parseClientsImport()).toBe(2);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Разобрано конфигов: 2",
    });

    vm.removeClientsImport(0);
    expect(vm.clientsImport).toHaveLength(1);
    expect(vm.clientsImportText).toBe(CLIENT_TWO);
  });

  it("берёт имена клиентов из файлов для импорта в интерфейс", async () => {
    const { vm, toasts } = setup();

    await vm.setClientsImportFiles(fileEvent([
      new File([CLIENT_ONE], "phone.conf", { type: "text/plain" }),
      new File([CLIENT_TWO], "tablet.conf", { type: "text/plain" }),
    ]));

    expect(vm.clientsImport.map((client) => client.name)).toEqual(["phone", "tablet"]);
    expect(vm.clientsImportText).toContain(CLIENT_ONE);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Загружено конфигов: 2",
    });
  });

  it("проверяет клиентов с автоопределением интерфейса", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    vm.setClientOwner(OWNER.id);
    vm.setClientsImportText(inputEvent(`${CLIENT_ONE}\n---\n${CLIENT_TWO}`));

    await vm.previewClientsNow();

    expect(imports.previewClients).toHaveBeenCalledWith({
      interface_id: null,
      owner_user_id: OWNER.id,
      clients: [
        { name: "client-1", config: CLIENT_ONE },
        { name: "client-2", config: CLIENT_TWO },
      ],
    });
    expect(vm.clientsStep).toBe(2);
    expect(vm.clientsPreview).toEqual(CLIENTS_PREVIEW);
    expect(vm.clientsPreviewSummary).toEqual(CLIENTS_PREVIEW.summary);
    expect(vm.clientsPreviewInterfaces[0]?.group_name).toBe("Main");
    expect(vm.clientsPreviewWarnings).toEqual(["auto match"]);
    expect(
      vm.previewStatusLabel(vm.clientsPreviewInterfaces[0]!.clients[1]!.status),
    ).toBe("ошибка");
    expect(vm.previewClientReason(vm.clientsPreviewInterfaces[0]!.clients[1]!)).toBe(
      "interface not found",
    );
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Проверка завершена: создать 1, дубликатов 0, ошибок 1",
    });
  });

  it("передаёт выбранный интерфейс при проверке клиентов", async () => {
    const { vm, imports } = setup();
    await vm.created();
    vm.setClientInterface(EXISTING_INTERFACE.id);
    vm.setClientsImportText(inputEvent(CLIENT_ONE));

    await vm.previewClientsNow();

    expect(imports.previewClients).toHaveBeenCalledWith(
      expect.objectContaining({ interface_id: EXISTING_INTERFACE.id }),
    );
  });

  it("сбрасывает план клиентов при изменении формы", async () => {
    const { vm } = setup();
    await vm.created();
    vm.setClientsImportText(inputEvent(CLIENT_ONE));
    await vm.previewClientsNow();

    expect(vm.clientsPreview).not.toBeNull();
    vm.setClientOwner(OWNER.id);

    expect(vm.clientsPreview).toBeNull();
    expect(vm.clientsStep).toBe(1);
    expect(vm.clientsPlanInvalidated).toBe(true);
    expect(vm.canApplyClients).toBe(false);
  });

  it("не применяет клиентов без проверки", async () => {
    const { vm, imports, toasts } = setup();
    vm.setClientsImportText(inputEvent(CLIENT_ONE));

    await vm.applyClientsNow();

    expect(imports.applyClients).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Сначала выполните проверку",
    });
  });

  it("применяет клиентов и показывает результат с ошибками", async () => {
    const { vm, imports, router } = setup();
    await vm.created();
    vm.setClientsImportText(inputEvent(`${CLIENT_ONE}\n---\n${CLIENT_TWO}`));
    await vm.previewClientsNow();

    await vm.applyClientsNow();

    expect(imports.applyClients).toHaveBeenCalledTimes(1);
    expect(imports.applyClients).toHaveBeenCalledWith({
      interface_id: null,
      owner_user_id: null,
      clients: [
        { name: "client-1", config: CLIENT_ONE },
        { name: "client-2", config: CLIENT_TWO },
      ],
    });
    expect(vm.clientsApplied).toEqual(CLIENTS_APPLIED);
    expect(vm.clientsStep).toBe(3);
    expect(vm.clientsApplying).toBe(false);
    expect(vm.clientsApplyError).toBeNull();
    expect(vm.clientsResultInterfaceCount).toBe(1);
    expect(vm.clientsResultDeviceCount).toBe(1);
    expect(vm.clientsResultCreatedCount).toBe(1);
    expect(vm.clientsResultDuplicateCount).toBe(0);
    expect(vm.clientsResultErrorCount).toBe(1);
    expect(vm.clientsResultGroupId).toBe("g1");
    expect(vm.clientsResultGroupPath).toBe("/groups/g1");
    expect(vm.clientsResultFailures).toEqual([
      {
        interfaceName: "awg0",
        groupName: "Main",
        clientName: "client-2",
        reason: "interface not found",
      },
    ]);

    vm.openClientsGroup();
    expect(router.path).toBe("/groups/g1");
    vm.openInterfaces();
    expect(router.path).toBe("/interfaces");
  });

  it("показывает фатальную ошибку импорта клиентов", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    vm.setClientsImportText(inputEvent(CLIENT_ONE));
    await vm.previewClientsNow();
    vi.mocked(imports.applyClients).mockRejectedValueOnce(new Error("Транзакция прервана"));

    await vm.applyClientsNow();

    expect(vm.clientsApplying).toBe(false);
    expect(vm.clientsApplied).toBeNull();
    expect(vm.clientsApplyError).toBe("Транзакция прервана");
    expect(vm.clientsStep).toBe(2);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Транзакция прервана",
    });
  });

  it("показывает ошибку проверки клиентов", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    vm.setClientsImportText(inputEvent(CLIENT_ONE));
    vi.mocked(imports.previewClients).mockRejectedValueOnce(new Error("Нет интерфейсов"));

    await vm.previewClientsNow();

    expect(vm.clientsPreviewing).toBe(false);
    expect(vm.clientsPreview).toBeNull();
    expect(vm.clientsPreviewError).toBe("Нет интерфейсов");
    expect(vm.clientsStep).toBe(2);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Нет интерфейсов",
    });
  });

  it("сбрасывает импорт клиентов", async () => {
    const { vm } = setup();
    await vm.created();
    vm.setClientInterface(EXISTING_INTERFACE.id);
    vm.setClientOwner(OWNER.id);
    vm.setClientsImportText(inputEvent(CLIENT_ONE));
    await vm.previewClientsNow();

    vm.resetClientsImport();

    expect(vm.clientsStep).toBe(1);
    expect(vm.clientOwnerUserId).toBe("");
    expect(vm.clientInterfaceId).toBe("");
    expect(vm.clientsImportText).toBe("");
    expect(vm.clientsImport).toEqual([]);
    expect(vm.clientsPreview).toBeNull();
    expect(vm.clientsApplied).toBeNull();
    expect(vm.clientsPreviewError).toBeNull();
    expect(vm.clientsApplyError).toBeNull();
    expect(vm.clientsPlanInvalidated).toBe(false);
  });

  it("переходит к нодам через роутер", () => {
    const { vm, router } = setup();

    vm.openNodes();

    expect(router.path).toBe("/nodes");
  });

  it("резолвится контейнером без ручных привязок", async () => {
    const container = createAppContainer();

    const vm = await container.resolve(ImportVM);

    expect(vm).toBeInstanceOf(ImportVM);
    expect(await container.resolve(ImportVM)).toBe(vm);
  });
});
