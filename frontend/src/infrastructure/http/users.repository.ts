import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import type { ApproveUserInput, CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { User } from "@/domain/types";
import type { HttpClient } from "./client";
import { readUser, readUsers } from "./response";

export class HttpUsersRepository implements UsersRepository {
  constructor(private readonly client: HttpClient) {}

  listUsers(): Promise<User[]> {
    return this.client.get<unknown>("/users").then(readUsers);
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
