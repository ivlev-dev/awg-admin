import type { User } from "../types";
import { slicePage, type Page } from "../page";
import type { UserPageParams } from "./types";

export function isPendingUser(user: User): boolean {
  return user.status === "pending_email" || user.status === "pending_approval";
}

export function filterUsers(items: readonly User[], params: UserPageParams): User[] {
  const query = params.query?.trim().toLowerCase() ?? "";
  return items
    .filter((user) => {
      if (params.tab === "pending" && !isPendingUser(user)) return false;
      if (params.tab === "active" && isPendingUser(user)) return false;
      if (params.role !== undefined && user.role !== params.role) return false;
      if (params.status === "active" && user.disabled) return false;
      if (params.status === "disabled" && !user.disabled) return false;
      if (query.length === 0) return true;
      return (
        user.email.toLowerCase().includes(query) ||
        (user.full_name ?? "").toLowerCase().includes(query)
      );
    })
    .sort((left, right) => left.email.localeCompare(right.email));
}

export function pageUsersFromList(items: readonly User[], params: UserPageParams): Page<User> {
  return slicePage(filterUsers(items, params), params.limit, params.offset);
}
