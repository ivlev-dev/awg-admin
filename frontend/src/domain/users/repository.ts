import type { User } from "../types";
import type { CreateUserInput, UpdateUserInput } from "./types";

export interface UsersRepository {
  listUsers(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
}
