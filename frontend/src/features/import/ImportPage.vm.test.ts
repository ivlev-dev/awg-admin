import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { DefaultImportService } from "@/application/import/service";
import { DefaultNodesService } from "@/application/nodes/service";
import type { ImportRepository } from "@/domain/import/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { ImportResult, NodeInfo } from "@/domain/types";
import { ImportVM } from "./ImportPage.vm";

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

const RESULT: ImportResult = {
  group_id: "g1",
  interface_id: "i1",
  imported_devices: 2,
  failed_devices: [],
};

const SERVER_CONFIG = "[Interface]\nPrivateKey = server-key";

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
      deleteNode: vi.fn(async () => undefined),
    },
  };
}

function importHarness(result: ImportResult): {
  repository: ImportRepository;
  importConfig: ReturnType<typeof vi.fn>;
} {
  const importConfig = vi.fn(async () => result);
  return {
    importConfig,
    repository: { importConfig },
  };
}

function setup(nodeList: NodeInfo[] = [NODE_OFFLINE, NODE_ONLINE]) {
  const nodes = nodesHarness(nodeList);
  const imports = importHarness(RESULT);
  window.history.replaceState(null, "", "/import");
  const router = new Router();
  const toasts = new ToastStore();
  const vm = new ImportVM(
    new DefaultImportService(imports.repository),
    new DefaultNodesService(nodes.repository),
    router,
    toasts,
  );
  return { vm, nodes, imports, router, toasts };
}

function fillValid(vm: ImportVM): void {
  vm.serverConfig = SERVER_CONFIG;
  vm.groupName = "Imported";
  vm.groupDescription = "  ";
  vm.endpointHost = "vpn.example.com";
  vm.clientsText = `${CLIENT_ONE}\n---\n${CLIENT_TWO}`;
}

describe("ImportPageVM", () => {
  it("загружает ноды и выбирает первую онлайн-ноду", async () => {
    const { vm, nodes } = setup();

    await vm.created();

    expect(nodes.listNodes).toHaveBeenCalledTimes(1);
    expect(vm.nodes).toEqual([NODE_OFFLINE, NODE_ONLINE]);
    expect(vm.nodesLoading).toBe(false);
    expect(vm.nodeId).toBe(NODE_ONLINE.id);
    expect(vm.nodesError).toBeNull();
  });

  it("выбирает первую ноду, если онлайн-нод нет", async () => {
    const { vm } = setup([NODE_OFFLINE]);

    await vm.created();

    expect(vm.nodeId).toBe(NODE_OFFLINE.id);
  });

  it("показывает ошибку загрузки нод", async () => {
    const { vm, nodes, toasts } = setup();
    vi.mocked(nodes.listNodes).mockRejectedValueOnce(new Error("Ноды недоступны"));

    await vm.loadNodes();

    expect(vm.nodesLoading).toBe(false);
    expect(vm.nodesError).toBe("Ноды недоступны");
    expect(vm.nodes).toEqual([]);
    expect(toasts.items.at(-1)).toMatchObject({ kind: "error", message: "Ноды недоступны" });
  });

  it("разбирает клиентские конфиги и подписывает их уникальными именами", async () => {
    const { vm, toasts } = setup();

    vm.clientsText = `${CLIENT_ONE}\n---\n${CLIENT_TWO}\n---\n${CLIENT_ONE}`;
    const parsed = vm.parseClients();

    expect(parsed).toBe(3);
    expect(vm.clients.map((client) => client.name)).toEqual(["client-1", "client-2", "client-3"]);
    expect(vm.clients[0]?.config).toBe(CLIENT_ONE);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Разобрано конфигов: 3",
    });
  });

  it("не разбирает пустой текст клиентских конфигов", () => {
    const { vm, toasts } = setup();

    vm.clientsText = "   ";

    expect(vm.parseClients()).toBe(0);
    expect(vm.clients).toEqual([]);
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Вставьте клиентские конфиги",
    });
  });

  it("не уведомляет при разборе без notify", () => {
    const { vm, toasts } = setup();

    vm.clientsText = CLIENT_ONE;

    expect(vm.parseClients(false)).toBe(1);
    expect(toasts.items).toHaveLength(0);
    expect(vm.clients).toHaveLength(1);
  });

  it("извлекает адрес, ключ пира и превью конфига", () => {
    const { vm } = setup();

    expect(vm.clientAddress(CLIENT_ONE)).toBe("10.8.0.2/24");
    expect(vm.clientPeerKey(CLIENT_ONE)).toBe("peer-a");
    expect(vm.clientPeerKey("[Interface]\nPrivateKey = x")).toBeNull();
    expect(vm.clientAddress("[Interface]\nPrivateKey = x")).toBe("—");
    expect(vm.clientPreview(CLIENT_ONE).split("\n")).toHaveLength(6);
  });

  it("проверяет совпадение ключей пиров", () => {
    const { vm } = setup();

    vm.clients = [
      { name: "a", config: CLIENT_ONE },
      { name: "b", config: CLIENT_TWO },
    ];
    expect(vm.distinctClientKeys).toEqual(["peer-a", "peer-b"]);
    expect(vm.clientKeysMismatch).toBe(true);
    expect(vm.clientsWithoutKey).toBe(0);

    vm.clients = [
      { name: "a", config: CLIENT_ONE },
      { name: "b", config: "[Interface]\nAddress = 10.0.0.2/24" },
    ];
    expect(vm.distinctClientKeys).toEqual(["peer-a"]);
    expect(vm.clientKeysMismatch).toBe(false);
    expect(vm.clientsWithoutKey).toBe(1);
  });

  it("импортирует конфиги и показывает успешный результат", async () => {
    const { vm, imports, router, toasts } = setup();
    await vm.created();
    fillValid(vm);

    expect(vm.serverConfigValid).toBe(true);
    expect(vm.paramsValid).toBe(true);
    expect(vm.canImport).toBe(true);

    await vm.importNow();

    expect(imports.importConfig).toHaveBeenCalledTimes(1);
    expect(imports.importConfig).toHaveBeenCalledWith({
      server_config: SERVER_CONFIG,
      node_id: NODE_ONLINE.id,
      group_name: "Imported",
      group_description: "",
      base_cidr: "10.8.0.0/24",
      pools: [
        {
          name: "default",
          cidr: "10.8.0.0/24",
          mode: "auto",
          gateway: null,
        },
      ],
      interface: {
        name: "awg0",
        endpoint_host: "vpn.example.com",
        endpoint_port: 51820,
        listen_port: 51820,
        mtu: 1280,
      },
      clients: [
        { name: "client-1", config: CLIENT_ONE },
        { name: "client-2", config: CLIENT_TWO },
      ],
      owner_user_id: null,
    });
    expect(vm.result).toEqual(RESULT);
    expect(vm.importing).toBe(false);
    expect(vm.error).toBeNull();
    expect(vm.resultFailed).toEqual([]);
    expect(vm.resultGroupPath).toBe("/groups/g1");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "success",
      message: "Импортировано устройств: 2",
    });

    vm.openGroup();
    expect(router.path).toBe("/groups/g1");
  });

  it("показывает ошибки импорта по устройствам", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);
    const failed: ImportResult = {
      group_id: "g1",
      interface_id: "i1",
      imported_devices: 1,
      failed_devices: [{ name: "client-2", error: "Ключ уже используется" }],
    };
    vi.mocked(imports.importConfig).mockResolvedValueOnce(failed);

    await vm.importNow();

    expect(vm.result).toEqual(failed);
    expect(vm.resultFailed).toEqual(failed.failed_devices);
    expect(vm.resultGroupPath).toBe("/groups/g1");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Импортировано 1, ошибок 1",
    });
  });

  it("показывает ошибку импорта и сбрасывает состояние загрузки", async () => {
    const { vm, imports, toasts } = setup();
    await vm.created();
    fillValid(vm);
    vi.mocked(imports.importConfig).mockRejectedValueOnce(new Error("Некорректный конфиг сервера"));

    await vm.importNow();

    expect(vm.importing).toBe(false);
    expect(vm.result).toBeNull();
    expect(vm.error).toBe("Некорректный конфиг сервера");
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Некорректный конфиг сервера",
    });
  });

  it("не отправляет импорт с невалидными параметрами", async () => {
    const { vm, imports, toasts } = setup();

    await vm.importNow();

    expect(imports.importConfig).not.toHaveBeenCalled();
    expect(toasts.items.at(-1)).toMatchObject({
      kind: "error",
      message: "Заполните обязательные поля",
    });
  });

  it("разбирает клиентов из текста перед импортом", async () => {
    const { vm, imports } = setup();
    await vm.created();
    fillValid(vm);

    expect(vm.clients).toEqual([]);
    await vm.importNow();

    expect(vm.clients).toHaveLength(2);
    expect(imports.importConfig).toHaveBeenCalledTimes(1);
  });

  it("не отправляет импорт повторно во время выполнения", async () => {
    const { vm, imports } = setup();
    await vm.created();
    fillValid(vm);
    vm.importing = true;

    await vm.importNow();

    expect(imports.importConfig).not.toHaveBeenCalled();
  });

  it("сбрасывает форму", async () => {
    const { vm } = setup();
    await vm.created();
    fillValid(vm);
    vm.parseClients();
    vm.addPool();

    vm.reset();

    expect(vm.serverConfig).toBe("");
    expect(vm.groupName).toBe("");
    expect(vm.baseCidr).toBe("10.8.0.0/24");
    expect(vm.interfaceName).toBe("awg0");
    expect(vm.endpointPort).toBe(51820);
    expect(vm.listenPort).toBe(51820);
    expect(vm.mtu).toBe(1280);
    expect(vm.pools).toHaveLength(1);
    expect(vm.clientsText).toBe("");
    expect(vm.clients).toEqual([]);
    expect(vm.result).toBeNull();
    expect(vm.error).toBeNull();
    expect(vm.nodeId).toBe(NODE_ONLINE.id);
  });

  it("проверяет пулы и параметры интерфейса", async () => {
    const { vm } = setup();
    await vm.created();

    vm.addPool();
    expect(vm.pools).toHaveLength(2);
    expect(vm.pools[1]?.name).toBe("pool-2");
    expect(vm.poolError(vm.pools[1]!)).toBeNull();

    vm.pools[1]!.cidr = "192.168.0.0/24";
    expect(vm.poolError(vm.pools[1]!)).toBe("Пул должен входить в base CIDR");
    expect(vm.poolsValid).toBe(false);

    vm.removePool(1);
    expect(vm.pools).toHaveLength(1);

    vm.interfaceName = " ";
    vm.endpointHost = "host";
    vm.mtu = 100;
    expect(vm.interfaceValid).toBe(false);

    vm.endpointHost = "   ";
    vm.mtu = 1280;
    expect(vm.interfaceValid).toBe(false);
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
