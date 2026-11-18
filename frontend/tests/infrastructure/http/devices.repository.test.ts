import { HttpDevicesRepository } from "@/infrastructure/http/devices.repository";
import type { HttpClient } from "@/infrastructure/http/client";
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
