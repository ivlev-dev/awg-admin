import { computed, reactive } from "@ivlev-dev/silent-core";

import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import type { AuditService } from "@/application/audit/service";
import type { AuditEntry, AuditFilters } from "@/domain/audit/types";
import { t } from "@/i18n";
import { formatDateTimeI18n, pluralI18n } from "@/i18n/format";

const PAGE_LIMIT = 50;
const DETAILS_PREVIEW = 120;
const ID_PREVIEW = 8;

const ACTIONS = ["POST", "PATCH", "PUT", "DELETE"] as const;

const STATUSES = [200, 201, 204, 400, 401, 403, 404, 409, 429, 500] as const;

const QUERY_LIMIT = 200;
const DATE_LIMIT = 32;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export interface AuditFiltersState {
  action: string;
  entity: string;
  actor: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFiltersState = {
  action: "",
  entity: "",
  actor: "",
  status: "",
  from: "",
  to: "",
};

export const auditFiltersStorage = persistedSignal<AuditFiltersState>(
  "awg.ui.audit.filters",
  EMPTY_FILTERS,
  validateAuditFilters,
);

export interface AuditRowView {
  id: string;
  at: string;
  actor: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  entityLabel: string;
  status: number;
  statusClass: string;
  ip: string;
  details: string | null;
  detailsPreview: string;
  hasDetails: boolean;
}

function readInput(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.value : "";
}

function toUnix(value: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000);
}

function formatAt(value: string): string {
  return formatDateTimeI18n(value);
}

function statusClass(status: number): string {
  if (status >= 500) return "badge--red";
  if (status >= 400) return "badge--amber";
  if (status >= 200 && status < 300) return "badge--green";
  return "badge--blue";
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function shortId(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  return value.length > ID_PREVIEW ? `${value.slice(0, ID_PREVIEW)}…` : value;
}

function appendUnique(current: AuditEntry[], incoming: AuditEntry[]): AuditEntry[] {
  const seen = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatAuditRow(entry: AuditEntry): AuditRowView {
  const entityLabel = entry.entity_id
    ? `${entry.entity} · ${shortId(entry.entity_id)}`
    : entry.entity;
  return {
    id: entry.id,
    at: formatAt(entry.at),
    actor: entry.actor_login,
    actorId: entry.actor_id,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entity_id,
    entityLabel,
    status: entry.status,
    statusClass: statusClass(entry.status),
    ip: entry.ip ?? "—",
    details: entry.details,
    detailsPreview: entry.details ? truncate(entry.details, DETAILS_PREVIEW) : "—",
    hasDetails: entry.details !== null && entry.details.length > DETAILS_PREVIEW,
  };
}

export class AuditPageVM {
  @reactive accessor entries: AuditEntry[] = [];
  @reactive accessor loading = false;
  @reactive accessor initialized = false;
  @reactive accessor loadingMore = false;
  @reactive accessor clearing = false;
  @reactive accessor error: string | null = null;
  @reactive accessor cursor: string | null = null;
  @reactive accessor expandedId: string | null = null;

  @reactive accessor action = "";
  @reactive accessor entity = "";
  @reactive accessor actor = "";
  @reactive accessor status = "";
  @reactive accessor from = "";
  @reactive accessor to = "";

  constructor(
    private readonly auditService: AuditService,
    private readonly toasts: ToastStore,
  ) {
    const stored = auditFiltersStorage.read();
    this.action = stored.action;
    this.entity = stored.entity;
    this.actor = stored.actor;
    this.status = stored.status;
    this.from = stored.from;
    this.to = stored.to;
  }

  created(): void {
    void this.reload();
  }

  @computed
  get actionOptions(): { value: string; label: string }[] {
    return [
      { value: "", label: t("audit.filter.allActions") },
      ...ACTIONS.map((action) => ({ value: action, label: action })),
    ];
  }

  @computed
  get statusOptions(): { value: string; label: string }[] {
    return [
      { value: "", label: t("audit.filter.allStatuses") },
      ...STATUSES.map((status) => ({ value: String(status), label: String(status) })),
    ];
  }

  @computed
  get loadedLabel(): string {
    const value = `${this.total} ${pluralI18n(this.total, "common.events.one", "common.events.few", "common.events.many")}`;
    return t("audit.log.loaded", { value });
  }

  @computed
  get rows(): AuditRowView[] {
    return this.entries.map((entry) => formatAuditRow(entry));
  }

  @computed
  get total(): number {
    return this.entries.length;
  }

  @computed
  get hasMore(): boolean {
    return this.cursor !== null;
  }

  @computed
  get isEmpty(): boolean {
    return !this.loading && this.entries.length === 0;
  }

  @computed
  get hasActiveFilters(): boolean {
    return (
      this.action !== "" ||
      this.entity.trim() !== "" ||
      this.actor.trim() !== "" ||
      this.status !== "" ||
      this.from !== "" ||
      this.to !== ""
    );
  }

  get canExport(): boolean {
    return this.entries.length > 0;
  }

  @computed
  get canClear(): boolean {
    return !this.loading && !this.clearing && this.hasActiveFilters;
  }

  setAction(value: string): void {
    this.action = value;
    this.persistFilters();
  }

  setStatus(value: string): void {
    this.status = value;
    this.persistFilters();
  }

  setEntity(event: Event): void {
    this.entity = readInput(event);
    this.persistFilters();
  }

  setActor(event: Event): void {
    this.actor = readInput(event);
    this.persistFilters();
  }

  setFrom(event: Event): void {
    this.from = readInput(event);
    this.persistFilters();
  }

  setTo(event: Event): void {
    this.to = readInput(event);
    this.persistFilters();
  }

  async apply(): Promise<void> {
    const error = this.periodError();
    if (error !== null) {
      this.error = error;
      return;
    }
    this.persistFilters();
    await this.reload();
  }

  async reset(): Promise<void> {
    this.action = "";
    this.entity = "";
    this.actor = "";
    this.status = "";
    this.from = "";
    this.to = "";
    this.expandedId = null;
    auditFiltersStorage.clear();
    await this.reload();
  }

  async refresh(): Promise<void> {
    await this.reload();
  }

  async clearFiltered(): Promise<void> {
    if (!this.canClear) return;
    if (!window.confirm(t("audit.clear.confirm"))) return;
    this.clearing = true;
    this.error = null;
    try {
      const deleted = await this.auditService.clear(this.filters(null));
      this.toasts.success(t("audit.clear.success", { count: deleted }));
      await this.refresh();
    } catch (error) {
      const message = userMessage(error, t("audit.clear.error"));
      this.error = message;
      this.toasts.error(message);
    } finally {
      this.clearing = false;
    }
  }

  async reload(): Promise<void> {
    if (this.loading || this.loadingMore) return;
    this.cursor = null;
    await this.loadPage(null);
  }

  async loadMore(): Promise<void> {
    const before = this.cursor;
    if (before === null || this.loading || this.loadingMore) return;
    await this.loadPage(before);
  }

  toggleDetails(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  exportCsv(): void {
    if (this.entries.length === 0) return;
    const lines = ["at,actor,action,entity,entity_id,status,ip,details"];
    for (const entry of this.entries) {
      lines.push(
        [
          csvCell(entry.at),
          csvCell(entry.actor_login),
          csvCell(entry.action),
          csvCell(entry.entity),
          csvCell(entry.entity_id ?? ""),
          String(entry.status),
          csvCell(entry.ip ?? ""),
          csvCell(entry.details ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit.csv";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async loadPage(before: string | null): Promise<void> {
    if (before === null) {
      this.loading = true;
    } else {
      this.loadingMore = true;
    }
    this.error = null;
    try {
      const result = await this.auditService.list(this.filters(before));
      this.entries = before === null ? result.items : appendUnique(this.entries, result.items);
      this.cursor = result.next_cursor;
    } catch (error) {
      this.error = userMessage(error, t("audit.error.load"));
    } finally {
      this.loading = false;
      this.loadingMore = false;
      if (before === null) this.initialized = true;
    }
  }

  private filters(before: string | null): AuditFilters {
    return {
      limit: PAGE_LIMIT,
      before,
      action: this.action,
      entity: this.entity,
      actor: this.actor,
      status: this.status === "" ? undefined : Number(this.status),
      from: toUnix(this.from),
      to: toUnix(this.to),
    };
  }

  private persistFilters(): void {
    auditFiltersStorage.write({
      action: this.action,
      entity: this.entity,
      actor: this.actor,
      status: this.status,
      from: this.from,
      to: this.to,
    });
  }

  private periodError(): string | null {
    const from = toUnix(this.from);
    const to = toUnix(this.to);
    if (from !== undefined && to !== undefined && from > to) return t("audit.error.period");
    return null;
  }
}

function validateAuditFilters(value: unknown): AuditFiltersState | null {
  if (!isRecord(value)) return null;
  const action = stringField(value, "action", 16);
  const entity = stringField(value, "entity", QUERY_LIMIT);
  const actor = stringField(value, "actor", QUERY_LIMIT);
  const status = stringField(value, "status", 8);
  const from = dateField(value["from"]);
  const to = dateField(value["to"]);
  if (
    action === null ||
    entity === null ||
    actor === null ||
    status === null ||
    from === null ||
    to === null
  ) {
    return null;
  }
  if (action !== "" && !(ACTIONS as readonly string[]).includes(action)) return null;
  if (status !== "" && !STATUSES.some((item) => String(item) === status)) return null;
  const fromTime = from === "" ? null : new Date(from).getTime();
  const toTime = to === "" ? null : new Date(to).getTime();
  if (fromTime !== null && Number.isNaN(fromTime)) return null;
  if (toTime !== null && Number.isNaN(toTime)) return null;
  if (fromTime !== null && toTime !== null && fromTime > toTime) return null;
  return { action, entity, actor, status, from, to };
}

function dateField(value: unknown): string | null {
  if (typeof value !== "string" || value.length > DATE_LIMIT) return null;
  return value === "" || LOCAL_DATE.test(value) ? value : null;
}
