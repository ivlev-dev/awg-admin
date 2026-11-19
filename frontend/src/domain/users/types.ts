import type { PageRequest } from "../page";
import type { Role } from "../types";

export type UserPageTab = "active" | "pending";
export type UserPageStatus = "active" | "disabled";

export interface UserPageParams extends PageRequest {
  query?: string;
  role?: Role;
  status?: UserPageStatus;
  tab?: UserPageTab;
  signal?: AbortSignal;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
  tariff_id: string | null;
  node_id: string | null;
  group_id?: string | null;
}

export interface UpdateUserInput {
  email?: string;
  role?: Role;
  tariff_id?: string | null;
  node_id?: string | null;
  group_id?: string | null;
  disabled?: boolean;
}

export interface ApproveUserInput {
  tariff_id: string;
  node_id?: string | null;
  group_id?: string | null;
}
