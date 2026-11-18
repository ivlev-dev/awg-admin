import type { Role } from "../types";

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
