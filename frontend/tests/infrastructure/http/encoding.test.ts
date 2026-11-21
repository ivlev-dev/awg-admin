import type { HttpClient } from "@/infrastructure/http/client";
import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import { HttpGroupsRepository } from "@/infrastructure/http/groups.repository";
import { HttpInterfacesRepository } from "@/infrastructure/http/interfaces.repository";
import { HttpNodesRepository } from "@/infrastructure/http/nodes.repository";
import { HttpTariffsRepository } from "@/infrastructure/http/tariffs.repository";
import { HttpUsersRepository } from "@/infrastructure/http/users.repository";

interface Harness {
  client: HttpClient;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const get = vi.fn(async () => []);
  const post = vi.fn(async () => undefined);
  const patch = vi.fn(async () => undefined);
  const remove = vi.fn(async () => ({ revoked: 0 }));
  return {
    client: { get, post, patch, delete: remove } as unknown as HttpClient,
    get,
    post,
    patch,
    remove,
  };
}

describe("HTTP repositories: encodeURIComponent для path-сегментов", () => {
  it("экранирует id устройства и токен share-ссылки", async () => {
    const test = harness();
    const repository = new HttpDevicesRepository(test.client);

    await repository.listProfiles("d/1");
    expect(test.get).toHaveBeenLastCalledWith("/devices/d%2F1/profiles");

    await repository.getProfile("d/1", "i 1");
    expect(test.get).toHaveBeenLastCalledWith("/devices/d%2F1/profiles/i%201");

    await repository.deviceStats("d/1");
    expect(test.get).toHaveBeenLastCalledWith("/devices/d%2F1/stats", {});

    await repository.revokeShare("tok/en");
    expect(test.remove).toHaveBeenLastCalledWith("/shares/tok%2Fen");

    await repository.revokeAllShares("d/1");
    expect(test.remove).toHaveBeenLastCalledWith("/devices/d%2F1/shares");
  });

  it("экранирует id в users, groups, interfaces, nodes и tariffs", async () => {
    const test = harness();
    const users = new HttpUsersRepository(test.client);
    const groups = new HttpGroupsRepository(test.client);
    const interfaces = new HttpInterfacesRepository(test.client);
    const nodes = new HttpNodesRepository(test.client);
    const tariffs = new HttpTariffsRepository(test.client);

    await users.deleteUser("u/1");
    expect(test.remove).toHaveBeenLastCalledWith("/users/u%2F1");

    await groups.deleteGroup("g/1");
    expect(test.remove).toHaveBeenLastCalledWith("/groups/g%2F1");

    await groups.listPools("g 1");
    expect(test.get).toHaveBeenLastCalledWith("/groups/g%201/pools");

    await interfaces.deleteInterface("i/1");
    expect(test.remove).toHaveBeenLastCalledWith("/interfaces/i%2F1");

    await nodes.deleteNode("n/1");
    expect(test.remove).toHaveBeenLastCalledWith("/nodes/n%2F1");

    await tariffs.deleteTariff("t/1");
    expect(test.remove).toHaveBeenLastCalledWith("/tariffs/t%2F1");
  });

  it("не кодирует повторно query-параметры с URLSearchParams", async () => {
    const test = harness();
    const devices = new HttpDevicesRepository(test.client);
    test.get.mockResolvedValueOnce({ items: [], total: 0, limit: 10, offset: 0 });

    await devices.pageDevices({ limit: 10, offset: 0, query: "a/b & c", interfaceId: "i/1" });

    expect(test.get).toHaveBeenLastCalledWith(
      "/devices/page?limit=10&offset=0&q=a%2Fb+%26+c&interface_id=i%2F1",
      {},
    );
  });
});
