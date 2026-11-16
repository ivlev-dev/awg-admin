import type { Role } from "../types";

export interface CreateUserInput {
  login: string;
  password: string;
  role: Role;
  tariff_id: string | null;
  group_id: string | null;
}

export interface UpdateUserInput {
  role?: Role;
  tariff_id?: string | null;
  group_id?: string | null;
  disabled?: boolean;
}

export interface ApproveUserInput {
  tariff_id: string;
  group_id?: string | null;
}
