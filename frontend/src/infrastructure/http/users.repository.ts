import type { BulkRequest, BulkResult } from "@/domain/bulk";
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import type { ApproveUserInput, CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { User } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpUsersRepository implements UsersRepository {
  constructor(private readonly client: HttpClient) {}

  listUsers(): Promise<User[]> {
    return this.client.get<User[]>("/users");
  }

  listPending(): Promise<User[]> {
    return this.client.get<User[]>("/users/pending");
  }

  approveUser(id: string, input: ApproveUserInput): Promise<User> {
    return this.client.post<User>(`/users/${id}/approve`, input);
  }

  rejectUser(id: string): Promise<User> {
    return this.client.post<User>(`/users/${id}/reject`);
  }

  createUser(input: CreateUserInput): Promise<User> {
    return this.client.post<User>("/users", input);
  }

  updateUser(id: string, input: UpdateUserInput): Promise<User> {
    return this.client.patch<User>(`/users/${id}`, input);
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
