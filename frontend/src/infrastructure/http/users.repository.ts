import type { UsersRepository } from "../../domain/users/repository";
import type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { User } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpUsersRepository implements UsersRepository {
  constructor(private readonly client: HttpClient) {}

  listUsers(): Promise<User[]> {
    return this.client.get<User[]>("/users");
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
}
