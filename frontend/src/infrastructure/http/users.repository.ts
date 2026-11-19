import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { Page } from "@/domain/page";
import { pageUsersFromList } from "@/domain/users/query";
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import type {
  ApproveUserInput,
  CreateUserInput,
  UpdateUserInput,
  UserPageParams,
} from "@/domain/users/types";
import type { User } from "@/domain/types";
import type { HttpClient } from "./client";
import { isUnsupportedEndpoint } from "./fallback";
import { buildQueryString, signalOptions } from "./query";
import { readUser, readUserPage, readUsers } from "./response";

export class HttpUsersRepository implements UsersRepository {
  constructor(private readonly client: HttpClient) {}

  listUsers(): Promise<User[]> {
    return this.client.get<unknown>("/users").then(readUsers);
  }

  async pageUsers(params: UserPageParams): Promise<Page<User>> {
    try {
      const page = await this.client
        .get<unknown>(usersPagePath(params), signalOptions(params.signal))
        .then(readUserPage);
      return page;
    } catch (error) {
      if (!isUnsupportedEndpoint(error)) throw error;
      return pageUsersFromList(await this.listUsers(), params);
    }
  }

  listPending(): Promise<User[]> {
    return this.client.get<unknown>("/users/pending").then(readUsers);
  }

  approveUser(id: string, input: ApproveUserInput): Promise<User> {
    return this.client.post<unknown>(`/users/${id}/approve`, input).then(readUser);
  }

  rejectUser(id: string): Promise<User> {
    return this.client.post<unknown>(`/users/${id}/reject`).then(readUser);
  }

  createUser(input: CreateUserInput): Promise<User> {
    return this.client.post<unknown>("/users", input).then(readUser);
  }

  updateUser(id: string, input: UpdateUserInput): Promise<User> {
    return this.client.patch<unknown>(`/users/${id}`, input).then(readUser);
  }

  async deleteUser(id: string): Promise<void> {
    await this.client.delete(`/users/${id}`);
  }

  async resetPassword(id: string, password: string): Promise<void> {
    await this.client.post<void>(`/users/${id}/password`, { new_password: password });
  }

  bulk(action: UsersBulkAction, ids: readonly string[]): Promise<BulkResult> {
    const body: BulkRequest<UsersBulkAction> = { action, ids };
    return this.client.post<BulkResult>("/users/bulk", body);
  }
}

function usersPagePath(params: UserPageParams): string {
  const query = buildQueryString({
    limit: params.limit,
    offset: params.offset,
    q: params.query?.trim(),
    role: params.role,
    status: params.status,
    tab: params.tab,
  });
  return `/users/page${query}`;
}
