import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import type { HttpClient } from "@/infrastructure/http/client";
import { ApiError } from "@/domain/errors";
import type { Device, Profile } from "@/domain/types";

const DEVICE: Device = {
  id: "d1",
  user_id: "u1",
  group_id: "g1",
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  node_name: "node-1",
  name: "laptop",
  down_kbps: 0,
  up_kbps: 0,
  forwarding: { to_own_devices: false, allowed_devices: [] },
  revoked: false,
  created_at: "2020-01-01T00:00:00Z",
  peers: [
    {
      peer_id: "p1",
      label: "wg0",
      interface_id: "i1",
      interface_name: "wg0",
      public_key: "key-1",
      addresses: ["10.0.0.2"],
    },
  ],
  addresses: ["10.0.0.2"],
};

const PROFILE: Profile = {
  peer_id: "p1",
  label: "wg0",
  interface_id: "i1",
  interface_name: "wg0",
  node_id: "n1",
  endpoint: "vpn.example.com:51820",
  addresses: ["10.0.0.2"],
  conf: "[Interface]",
  vpn_link: "vpn://p1",
};

function makeRepository(): {
  repository: HttpDevicesRepository;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async () => []);
  const post = vi.fn(async () => DEVICE);
  const patch = vi.fn(async () => DEVICE);
  const remove = vi.fn(async () => undefined);
  const client = { get, post, patch, delete: remove } as unknown as HttpClient;
  return { repository: new HttpDevicesRepository(client), get, post, patch, delete: remove };
}

describe("HttpDevicesRepository: серверная пагинация", () => {
  it("кодирует параметры запроса страницы", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce({ items: [DEVICE], total: 1, limit: 50, offset: 0 });
    const signal = new AbortController().signal;

    const page = await repository.pageDevices({
      limit: 50,
      offset: 0,
      query: "my device & co",
      status: "active",
      interfaceId: "i 1",
      userId: "u/1",
      sort: "name",
      order: "desc",
      signal,
    });

    expect(get).toHaveBeenCalledWith(
      "/devices/page?limit=50&offset=0&q=my+device+%26+co&status=active&interface_id=i+1&user_id=u%2F1&sort=name&order=desc",
      { signal },
    );
    expect(page).toEqual({ items: [DEVICE], total: 1, limit: 50, offset: 0 });
  });

  it("не отправляет status=all и пустые фильтры", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 50 });

    await repository.pageDevices({ limit: 25, offset: 50, status: "all", query: "  " });

    expect(get).toHaveBeenCalledWith("/devices/page?limit=25&offset=50", {});
  });

  it("переходит на старый список при 404 и фильтрует локально", async () => {
    const { repository, get } = makeRepository();
    const phone: Device = { ...DEVICE, id: "d2", name: "phone", addresses: ["10.0.0.3"] };
    get
      .mockRejectedValueOnce(new ApiError(404, "not_found", "not found"))
      .mockResolvedValueOnce([DEVICE, phone]);

    const page = await repository.pageDevices({ limit: 1, offset: 1, query: "10.0.0" });

    expect(get).toHaveBeenNthCalledWith(1, "/devices/page?limit=1&offset=1&q=10.0.0", {});
    expect(get).toHaveBeenNthCalledWith(2, "/devices");
    expect(page).toEqual({ items: [phone], total: 2, limit: 1, offset: 1 });
  });

  it("не скрывает ошибки, кроме 404/405/501", async () => {
    const { repository, get } = makeRepository();
    get.mockRejectedValueOnce(new ApiError(500, "http_error", "boom"));

    await expect(repository.pageDevices({ limit: 25, offset: 0 })).rejects.toMatchObject({
      status: 500,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("HttpDevicesRepository: туннели", () => {
  it("создаёт туннель с меткой и без неё", async () => {
    const { repository, post } = makeRepository();

    await expect(repository.addTunnel("d1", { interfaceId: "i1", label: "extra" })).resolves.toEqual(
      DEVICE,
    );
    expect(post).toHaveBeenCalledWith("/devices/d1/tunnels", {
      interface_id: "i1",
      label: "extra",
    });

    await repository.addTunnel("d1", { interfaceId: "i1" });
    expect(post).toHaveBeenLastCalledWith("/devices/d1/tunnels", { interface_id: "i1" });
  });

  it("переименовывает и удаляет туннель", async () => {
    const { repository, patch, delete: remove } = makeRepository();

    await expect(repository.renameTunnel("d1", "p 1", "renamed")).resolves.toEqual(DEVICE);
    expect(patch).toHaveBeenCalledWith("/devices/d1/tunnels/p%201", { label: "renamed" });

    await repository.deleteTunnel("d1", "p1");
    expect(remove).toHaveBeenCalledWith("/devices/d1/tunnels/p1");
  });

  it("запрашивает профиль конкретного пира", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce(PROFILE);

    await expect(repository.profileByPeer("d1", "p1")).resolves.toEqual(PROFILE);
    expect(get).toHaveBeenCalledWith("/devices/d1/profiles/by-peer/p1");
  });

  it("берёт весь список профилей устройства", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce([PROFILE, { ...PROFILE, peer_id: "p2", label: "second" }]);

    await expect(repository.listProfiles("d1")).resolves.toHaveLength(2);
    expect(get).toHaveBeenCalledWith("/devices/d1/profiles");
  });
});
