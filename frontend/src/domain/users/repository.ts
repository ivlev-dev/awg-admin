import type { User } from "../types";
import type { ApproveUserInput, CreateUserInput, UpdateUserInput } from "./types";

export interface UsersRepository {
  listUsers(): Promise<User[]>;
  listPending(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
  approveUser(id: string, input: ApproveUserInput): Promise<User>;
  rejectUser(id: string): Promise<User>;
}
