import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { DefaultImportService } from "@/application/import/service";
import { DefaultNodesService } from "@/application/nodes/service";
import type { ImportRepository } from "@/domain/import/repository";
import type { NodesRepository } from "@/domain/nodes/repository";
import type { ImportResult, NodeInfo } from "@/domain/types";
import { ImportVM } from "./ImportPage.vm";

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

const RESULT: ImportResult = {
  group_id: "g1",
  interface_id: "i1",
  imported_devices: 1,
  failed_devices: [],
};

function nodesRepository(): NodesRepository {
  return {
    listNodes: vi.fn(async () => NODES.map((node) => ({ ...node }))),
    createNode: vi.fn(async () => {
      throw new Error("createNode is not used in this test");
    }),
    deleteNode: vi.fn(async () => undefined),
  };
}

function importRepository(): ImportRepository {
  return {
    importConfig: vi.fn(async () => RESULT),
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
    const imports = importRepository();
    const router = new Router();
    const toasts = new ToastStore();
    const container = createAppContainer();
    container.bind(DefaultNodesService, () => new DefaultNodesService(nodes));
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

    vm.serverConfig = "[Interface]\nPrivateKey = server-key";
    vm.groupName = "Imported";
    vm.endpointHost = "vpn.example.com";
    vm.clientsText = "[Interface]\nAddress = 10.8.0.2/24\n\n[Peer]\nPublicKey = peer-a";

    await vm.importNow();

    expect(imports.importConfig).toHaveBeenCalledWith(
      expect.objectContaining({ node_id: "n2", group_name: "Imported" }),
    );
    expect(vm.result).toEqual(RESULT);
    expect(toasts.items.at(-1)).toMatchObject({ kind: "success" });

    result.dispose();
  });
});
