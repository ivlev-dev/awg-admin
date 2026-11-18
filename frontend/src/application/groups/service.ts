import type { BulkResult } from "@/domain/bulk";
import type { GroupsRepository } from "@/domain/groups/repository";
import type { GroupInput, PoolInput } from "@/domain/groups/types";
import type { CidrPool, Group } from "@/domain/types";
import { isCidr } from "@/domain/validation";
import { ValidationError } from "../errors";
import { requireId, requireText } from "../guards";

export interface GroupsService {
  listGroups(): Promise<Group[]>;
  createGroup(input: GroupInput): Promise<Group>;
  updateGroup(id: string, input: Partial<GroupInput>): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult>;
  listPools(groupId: string): Promise<CidrPool[]>;
  createPool(groupId: string, input: PoolInput): Promise<CidrPool>;
  updatePool(id: string, input: Partial<PoolInput> & { enabled?: boolean }): Promise<CidrPool>;
  deletePool(id: string): Promise<void>;
}

export class DefaultGroupsService implements GroupsService {
  constructor(private readonly repository: GroupsRepository) {}

  listGroups(): Promise<Group[]> {
    return this.repository.listGroups();
  }

  async createGroup(input: GroupInput): Promise<Group> {
    return this.repository.createGroup(normalizeGroup(input));
  }

  async updateGroup(id: string, input: Partial<GroupInput>): Promise<Group> {
    const patch: Partial<GroupInput> = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "Название группы");
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.base_cidr !== undefined) patch.base_cidr = requireCidr(input.base_cidr);
    return this.repository.updateGroup(requireId(id, "Группа"), patch);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.repository.deleteGroup(requireId(id, "Группа"));
  }

  bulk(action: "delete", ids: readonly string[]): Promise<BulkResult> {
    const targets = ids.map((id) => requireId(id, "Группа"));
    return this.repository.bulk(action, targets);
  }

  listPools(groupId: string): Promise<CidrPool[]> {
    return this.repository.listPools(requireId(groupId, "Группа"));
  }

  async createPool(groupId: string, input: PoolInput): Promise<CidrPool> {
    return this.repository.createPool(
      requireId(groupId, "Группа"),
      normalizePool(input),
    );
  }

  async updatePool(
    id: string,
    input: Partial<PoolInput> & { enabled?: boolean },
  ): Promise<CidrPool> {
    const patch: Partial<PoolInput> & { enabled?: boolean } = { ...input };
    if (input.name !== undefined) patch.name = requireText(input.name, "Название пула");
    if (input.cidr !== undefined) patch.cidr = requireCidr(input.cidr);
    return this.repository.updatePool(requireId(id, "Пул"), patch);
  }

  async deletePool(id: string): Promise<void> {
    await this.repository.deletePool(requireId(id, "Пул"));
  }
}

function normalizeGroup(input: GroupInput): GroupInput {
  return {
    name: requireText(input.name, "Название группы"),
    description: input.description.trim(),
    base_cidr: requireCidr(input.base_cidr),
    forwarding_default: input.forwarding_default,
  };
}

function normalizePool(input: PoolInput): PoolInput {
  return {
    name: requireText(input.name, "Название пула"),
    cidr: requireCidr(input.cidr),
    mode: input.mode,
    gateway: input.gateway,
  };
}

function requireCidr(value: string): string {
  const cidr = value.trim();
  if (!isCidr(cidr)) throw new ValidationError(`Некорректный CIDR: ${value}`);
  return cidr;
}
