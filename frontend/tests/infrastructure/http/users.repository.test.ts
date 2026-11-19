import { HttpUsersRepository } from "@/infrastructure/http/users.repository";
import type { HttpClient } from "@/infrastructure/http/client";
import { ApiError } from "@/domain/errors";
import type { User } from "@/domain/types";

const ADMIN: User = {
  id: "u1",
  login: "admin",
  email: "admin@example.com",
  status: "active",
  totp_enabled: false,
  role: "admin",
  tariff_id: null,
  group_id: null,
  node_id: null,
  disabled: false,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
};

const PENDING: User = {
  ...ADMIN,
  id: "u2",
  login: "newbie",
  email: "newbie@example.com",
  role: "user",
  status: "pending_approval",
};

function makeRepository(): {
  repository: HttpUsersRepository;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async () => []);
  const client = { get } as unknown as HttpClient;
  return { repository: new HttpUsersRepository(client), get };
}

describe("HttpUsersRepository: серверная пагинация", () => {
  it("кодирует параметры страницы и фильтры", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce({ items: [ADMIN], total: 1, limit: 50, offset: 0 });
    const signal = new AbortController().signal;

    const page = await repository.pageUsers({
      limit: 50,
      offset: 0,
      query: "admin & co",
      role: "admin",
      status: "active",
      tab: "active",
      signal,
    });

    expect(get).toHaveBeenCalledWith(
      "/users/page?limit=50&offset=0&q=admin+%26+co&role=admin&status=active&tab=active",
      { signal },
    );
    expect(page).toEqual({ items: [ADMIN], total: 1, limit: 50, offset: 0 });
  });

  it("не отправляет пустые фильтры", async () => {
    const { repository, get } = makeRepository();
    get.mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 25 });

    await repository.pageUsers({ limit: 25, offset: 25, tab: "pending" });

    expect(get).toHaveBeenCalledWith("/users/page?limit=25&offset=25&tab=pending", {});
  });

  it("переходит на старый список при 405 и фильтрует локально", async () => {
    const { repository, get } = makeRepository();
    get
      .mockRejectedValueOnce(new ApiError(405, "method_not_allowed", "no"))
      .mockResolvedValueOnce([ADMIN, PENDING]);

    const page = await repository.pageUsers({ limit: 10, offset: 0, tab: "pending" });

    expect(get).toHaveBeenNthCalledWith(1, "/users/page?limit=10&offset=0&tab=pending", {});
    expect(get).toHaveBeenNthCalledWith(2, "/users");
    expect(page).toEqual({ items: [PENDING], total: 1, limit: 10, offset: 0 });
  });

  it("применяет поиск, роль и статус в fallback-режиме", async () => {
    const { repository, get } = makeRepository();
    const disabled: User = { ...ADMIN, id: "u3", login: "old", email: "old@example.com", disabled: true };
    get
      .mockRejectedValueOnce(new ApiError(501, "not_implemented", "no"))
      .mockResolvedValueOnce([ADMIN, PENDING, disabled]);

    const page = await repository.pageUsers({
      limit: 10,
      offset: 0,
      tab: "active",
      role: "admin",
      status: "disabled",
    });

    expect(page.items).toEqual([disabled]);
    expect(page.total).toBe(1);
  });
});
