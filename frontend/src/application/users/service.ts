import type { UsersRepository } from "../../domain/users/repository";
import type { CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { User } from "@/domain/types";
import { requireId, requireText, validatePassword } from "../guards";

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  listUsers(): Promise<User[]> {
    return this.repository.listUsers();
  }

  async createUser(input: CreateUserInput): Promise<User> {
    return this.repository.createUser({
      login: requireText(input.login, "Логин"),
      password: validatePassword(input.password),
      role: input.role,
      tariff_id: input.tariff_id,
      group_id: input.group_id,
    });
  }

  updateUser(id: string, input: UpdateUserInput): Promise<User> {
    return this.repository.updateUser(requireId(id, "Пользователь"), input);
  }

  async deleteUser(id: string): Promise<void> {
    await this.repository.deleteUser(requireId(id, "Пользователь"));
  }

  async resetPassword(id: string, password: string): Promise<void> {
    await this.repository.resetPassword(
      requireId(id, "Пользователь"),
      validatePassword(password),
    );
  }
}
