import type { BulkResult } from "../bulk";
import type { Page } from "../page";
import type { User } from "../types";
import type {
  ApproveUserInput,
  CreateUserInput,
  UpdateUserInput,
  UserPageParams,
} from "./types";

export type UsersBulkAction = "disable" | "enable" | "delete";

export interface UsersRepository {
  listUsers(): Promise<User[]>;
  pageUsers(params: UserPageParams): Promise<Page<User>>;
  listPending(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
  approveUser(id: string, input: ApproveUserInput): Promise<User>;
  rejectUser(id: string): Promise<User>;
  bulk(action: UsersBulkAction, ids: readonly string[]): Promise<BulkResult>;
}
