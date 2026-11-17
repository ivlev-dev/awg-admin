import type { UsersRepository } from "@/domain/users/repository";
import type { ApproveUserInput, CreateUserInput, UpdateUserInput } from "@/domain/users/types";
import type { User } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireId, requireText, validatePassword } from "../guards";

export interface UsersService {
  listUsers(): Promise<User[]>;
  listPending(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
  approveUser(id: string, input: ApproveUserInput): Promise<User>;
  rejectUser(id: string): Promise<User>;
}

export class DefaultUsersService implements UsersService {
  constructor(private readonly repository: UsersRepository) {}

  listUsers(): Promise<User[]> {
    return this.repository.listUsers();
  }

  listPending(): Promise<User[]> {
    return this.repository.listPending();
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

  async approveUser(id: string, input: ApproveUserInput): Promise<User> {
    if (!input.tariff_id.trim()) {
      throw new ValidationError("Выберите тариф");
    }
    return this.repository.approveUser(requireId(id, "Пользователь"), {
      tariff_id: input.tariff_id.trim(),
      group_id: input.group_id ? input.group_id : null,
    });
  }

  async rejectUser(id: string): Promise<User> {
    return this.repository.rejectUser(requireId(id, "Пользователь"));
  }
}
