import type { BulkResult } from "@/domain/bulk";
import type { Page } from "@/domain/page";
import { normalizePageRequest } from "@/domain/page";
import type { UsersBulkAction, UsersRepository } from "@/domain/users/repository";
import type {
  ApproveUserInput,
  CreateUserInput,
  UpdateUserInput,
  UserPageParams,
} from "@/domain/users/types";
import type { User } from "@/domain/types";
import { ValidationError } from "../errors";
import { requireId, validateEmail, validatePassword } from "../guards";

export interface UsersService {
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

export class DefaultUsersService implements UsersService {
  constructor(private readonly repository: UsersRepository) {}

  listUsers(): Promise<User[]> {
    return this.repository.listUsers();
  }

  pageUsers(params: UserPageParams): Promise<Page<User>> {
    return this.repository.pageUsers(normalizeUserPageParams(params));
  }

  listPending(): Promise<User[]> {
    return this.repository.listPending();
  }

  async createUser(input: CreateUserInput): Promise<User> {
    return this.repository.createUser({
      email: validateEmail(input.email),
      password: validatePassword(input.password),
      role: input.role,
      tariff_id: input.tariff_id,
      node_id: input.node_id,
      group_id: input.group_id,
    });
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    const email = input.email === undefined ? undefined : validateEmail(input.email);
    return this.repository.updateUser(requireId(id, "error.label.user"), {
      ...input,
      ...(email === undefined ? {} : { email }),
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.repository.deleteUser(requireId(id, "error.label.user"));
  }

  async resetPassword(id: string, password: string): Promise<void> {
    await this.repository.resetPassword(
      requireId(id, "error.label.user"),
      validatePassword(password),
    );
  }

  async approveUser(id: string, input: ApproveUserInput): Promise<User> {
    if (!input.tariff_id.trim()) {
      throw new ValidationError("error.validation.userTariffRequired");
    }
    return this.repository.approveUser(requireId(id, "error.label.user"), {
      tariff_id: input.tariff_id.trim(),
      node_id: input.node_id ? input.node_id : null,
      group_id: input.group_id ? input.group_id : null,
    });
  }

  async rejectUser(id: string): Promise<User> {
    return this.repository.rejectUser(requireId(id, "error.label.user"));
  }

  async bulk(action: UsersBulkAction, ids: readonly string[]): Promise<BulkResult> {
    const normalized = ids.map((id) => requireId(id, "error.label.user"));
    return this.repository.bulk(action, normalized);
  }
}

function normalizeUserPageParams(params: UserPageParams): UserPageParams {
  const { limit, offset } = normalizePageRequest(params);
  const query = params.query?.trim() ?? "";
  const role = params.role === "admin" || params.role === "user" ? params.role : undefined;
  const status =
    params.status === "active" || params.status === "disabled" ? params.status : undefined;
  const tab = params.tab === "active" || params.tab === "pending" ? params.tab : undefined;
  return {
    limit,
    offset,
    ...(query.length > 0 ? { query } : {}),
    ...(role === undefined ? {} : { role }),
    ...(status === undefined ? {} : { status }),
    ...(tab === undefined ? {} : { tab }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
  };
}
