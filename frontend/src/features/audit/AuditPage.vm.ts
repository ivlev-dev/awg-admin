import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { debounce } from "@/app/debounce";
import { isRecord, persistedSignal, stringField } from "@/app/persisted";
import { ToastStore } from "@/app/toast";
import { userMessage } from "@/application/errors";
import type { AuditService } from "@/application/audit/service";
import type { AuditEntry, AuditFilters } from "@/domain/audit/types";
import { copyText } from "@/domain/clipboard";
import { csvCell } from "@/domain/format";
import { t } from "@/i18n";
import { formatDateTimeI18n, pluralI18n } from "@/i18n/format";

const PAGE_LIMIT = 50;
const EXPORT_PAGE_LIMIT = PAGE_LIMIT;
const EXPORT_ROW_LIMIT = 10_000;
const DETAILS_PREVIEW = 120;
const ID_PREVIEW = 8;

const ACTIONS = ["POST", "PATCH", "PUT", "DELETE"] as const;

const STATUSES = [200, 201, 204, 400, 401, 403, 404, 409, 429, 500] as const;

const QUERY_LIMIT = 200;
const DATE_LIMIT = 32;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const PRESET_LIMIT = 10;
const PRESET_NAME_LIMIT = 80;
const PRESET_ID_LIMIT = 64;

export interface AuditFiltersState {
  action: string;
  entity: string;
  actor: string;
  status: string;
  from: string;
  to: string;
}

export interface AuditPreset {
  id: string;
  name: string;
  filters: AuditFiltersState;
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

export const auditPresetsStorage = persistedSignal<AuditPreset[]>(
  "awg.ui.audit.presets",
  [],
  validateAuditPresets,
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

export type AuditFilterKey = "action" | "entity" | "actor" | "status" | "from" | "to";

export interface AuditFilterChip {
  key: AuditFilterKey;
  label: string;
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

export function auditActor(entry: AuditEntry): string {
  const email = entry.actor_email?.trim() ?? "";
  if (email.length > 0) return email;
  const login = entry.actor_login?.trim() ?? "";
  return login.length > 0 ? login : "—";
}

export function formatAuditRow(entry: AuditEntry): AuditRowView {
  const entityLabel = entry.entity_id
    ? `${entry.entity} · ${shortId(entry.entity_id)}`
    : entry.entity;
  return {
    id: entry.id,
    at: formatAt(entry.at),
    actor: auditActor(entry),
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

export class AuditPageVM extends ViewModel {
  @reactive accessor entries: AuditEntry[] = [];
  @reactive accessor loading = false;
  @reactive accessor initialized = false;
  @reactive accessor loadingMore = false;
  @reactive accessor clearing = false;
  @reactive accessor exporting = false;
  @reactive accessor exportCount = 0;
  @reactive accessor error: string | null = null;
  @reactive accessor cursor: string | null = null;
  @reactive accessor detailsRow: AuditRowView | null = null;

  @reactive accessor action = "";
  @reactive accessor entity = "";
  @reactive accessor actor = "";
  @reactive accessor status = "";
  @reactive accessor from = "";
  @reactive accessor to = "";

  @reactive accessor presets: AuditPreset[] = [];
  @reactive accessor presetFormOpen = false;
  @reactive accessor presetName = "";
  @reactive accessor presetMenuOpen = false;

  private readonly persistDebounced = debounce(() => this.persistFilters(), 250);

  constructor(
    private readonly auditService: AuditService,
    private readonly toasts: ToastStore,
  ) {
    super();
    const stored = auditFiltersStorage.read();
    this.action = stored.action;
    this.entity = stored.entity;
    this.actor = stored.actor;
    this.status = stored.status;
    this.from = stored.from;
    this.to = stored.to;
    this.presets = auditPresetsStorage.read();
  }

  override created(): void {
    void this.reload();
  }

  override dispose(): void {
    this.persistDebounced.cancel();
    super.dispose();
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

  @computed
  get activeFilterChips(): AuditFilterChip[] {
    const chips: AuditFilterChip[] = [];
    if (this.action !== "") {
      chips.push({ key: "action", label: `${t("audit.filter.chip.action")}: ${this.action}` });
    }
    const entity = this.entity.trim();
    if (entity !== "") {
      chips.push({ key: "entity", label: `${t("audit.filter.chip.entity")}: ${entity}` });
    }
    const actor = this.actor.trim();
    if (actor !== "") {
      chips.push({ key: "actor", label: `${t("audit.filter.chip.actor")}: ${actor}` });
    }
    if (this.status !== "") {
      chips.push({ key: "status", label: `${t("audit.filter.chip.status")}: ${this.status}` });
    }
    if (this.from !== "") {
      chips.push({
        key: "from",
        label: `${t("audit.filter.chip.from")}: ${formatDateTimeI18n(this.from)}`,
      });
    }
    if (this.to !== "") {
      chips.push({
        key: "to",
        label: `${t("audit.filter.chip.to")}: ${formatDateTimeI18n(this.to)}`,
      });
    }
    return chips;
  }

  get canExport(): boolean {
    return this.entries.length > 0;
  }

  @computed
  get canClear(): boolean {
    return !this.loading && !this.clearing && this.hasActiveFilters;
  }

  @computed
  get canSavePreset(): boolean {
    return this.presetName.trim() !== "" && this.hasActiveFilters;
  }

  @computed
  get canAddPreset(): boolean {
    return this.presets.length < PRESET_LIMIT;
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
    this.persistDebounced();
  }

  setActor(event: Event): void {
    this.actor = readInput(event);
    this.persistDebounced();
  }

  setFrom(event: Event): void {
    this.from = readInput(event);
    this.persistDebounced();
  }

  setTo(event: Event): void {
    this.to = readInput(event);
    this.persistDebounced();
  }

  setPresetName(event: Event): void {
    this.presetName = readInput(event).slice(0, PRESET_NAME_LIMIT);
  }

  openPresetForm(): void {
    if (!this.hasActiveFilters) return;
    this.presetFormOpen = true;
    this.presetName = "";
    this.presetMenuOpen = false;
  }

  closePresetForm(): void {
    this.presetFormOpen = false;
    this.presetName = "";
  }

  togglePresetMenu(): void {
    this.presetMenuOpen = !this.presetMenuOpen;
  }

  closePresetMenu(): void {
    this.presetMenuOpen = false;
  }

  savePreset(): void {
    if (!this.canSavePreset) return;
    if (this.presets.length >= PRESET_LIMIT) {
      this.toasts.error(t("audit.presets.limit"));
      return;
    }
    const preset: AuditPreset = {
      id: createPresetId(),
      name: this.presetName.trim(),
      filters: this.currentFilters(),
    };
    this.persistPresets([...this.presets, preset]);
    this.presetFormOpen = false;
    this.presetName = "";
    this.toasts.success(t("audit.presets.saved"));
  }

  async applyPreset(id: string): Promise<void> {
    const preset = this.presets.find((item) => item.id === id);
    if (preset === undefined) return;
    this.action = preset.filters.action;
    this.entity = preset.filters.entity;
    this.actor = preset.filters.actor;
    this.status = preset.filters.status;
    this.from = preset.filters.from;
    this.to = preset.filters.to;
    this.detailsRow = null;
    this.presetFormOpen = false;
    this.presetName = "";
    this.presetMenuOpen = false;
    this.persistDebounced.cancel();
    this.persistFilters();
    await this.apply();
  }

  deletePreset(id: string): void {
    const next = this.presets.filter((item) => item.id !== id);
    if (next.length === this.presets.length) return;
    this.persistPresets(next);
    if (next.length === 0) this.presetMenuOpen = false;
    this.toasts.success(t("audit.presets.removed"));
  }

  async apply(): Promise<void> {
    const error = this.periodError();
    if (error !== null) {
      this.error = error;
      return;
    }
    this.persistDebounced.cancel();
    this.persistFilters();
    await this.reload();
  }

  async reset(): Promise<void> {
    this.persistDebounced.cancel();
    this.action = "";
    this.entity = "";
    this.actor = "";
    this.status = "";
    this.from = "";
    this.to = "";
    this.detailsRow = null;
    auditFiltersStorage.clear();
    await this.reload();
  }

  async refresh(): Promise<void> {
    await this.reload();
  }

  async clearFilter(key: AuditFilterKey): Promise<void> {
    if (this.loading || this.loadingMore) return;
    if (key === "action") this.action = "";
    if (key === "entity") this.entity = "";
    if (key === "actor") this.actor = "";
    if (key === "status") this.status = "";
    if (key === "from") this.from = "";
    if (key === "to") this.to = "";
    this.detailsRow = null;
    this.persistFilters();
    await this.refresh();
  }

  async copyDetails(row: AuditRowView): Promise<void> {
    const details = row.details;
    if (details === null || details.length === 0) return;
    try {
      await copyText(details);
      this.toasts.success(t("audit.copy.copied"));
    } catch {
      this.toasts.error(t("audit.copy.failed"));
    }
  }

  async clearFiltered(): Promise<void> {
    if (!this.canClear) return;
    const confirmed = await askConfirm({
      title: t("audit.clear.title"),
      message: t("audit.clear.confirm"),
      confirmLabel: t("audit.clear.action"),
    });
    if (!confirmed) return;
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
    this.detailsRow = null;
    this.cursor = null;
    await this.loadPage(null);
  }

  async loadMore(): Promise<void> {
    const before = this.cursor;
    if (before === null || this.loading || this.loadingMore) return;
    await this.loadPage(before);
  }

  openDetails(row: AuditRowView): void {
    this.detailsRow = row;
  }

  closeDetails(): void {
    this.detailsRow = null;
  }

  exportCsv(): void {
    void this.runExport();
  }

  async buildCsv(): Promise<string> {
    const { entries } = await this.collectForExport();
    this.exportCount = entries.length;
    return csvContent(entries);
  }

  private async runExport(): Promise<void> {
    if (this.exporting) return;
    this.exporting = true;
    this.exportCount = 0;
    try {
      const { entries, capped } = await this.collectForExport();
      this.exportCount = entries.length;
      if (entries.length === 0) {
        this.toasts.error(t("audit.export.empty"));
        return;
      }
      downloadCsv(csvContent(entries));
      if (capped) {
        this.toasts.push(t("audit.export.truncated", { count: entries.length }), "info");
      } else {
        this.toasts.success(t("audit.export.ready", { count: entries.length }));
      }
    } catch (error) {
      this.toasts.error(userMessage(error, t("audit.export.error")));
    } finally {
      this.exporting = false;
    }
  }

  private async collectForExport(): Promise<{ entries: AuditEntry[]; capped: boolean }> {
    const entries: AuditEntry[] = [];
    const seen = new Set<string>();
    let before: string | null = null;
    let capped = false;
    for (;;) {
      const remaining = EXPORT_ROW_LIMIT - entries.length;
      if (remaining <= 0) {
        capped = true;
        break;
      }
      const result = await this.auditService.list({
        ...this.filters(before),
        limit: Math.min(EXPORT_PAGE_LIMIT, remaining),
      });
      for (const entry of result.items) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
      }
      this.exportCount = entries.length;
      if (result.next_cursor === null || result.items.length === 0) break;
      if (entries.length >= EXPORT_ROW_LIMIT) {
        capped = true;
        break;
      }
      before = result.next_cursor;
    }
    return { entries, capped };
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
    auditFiltersStorage.write(this.currentFilters());
  }

  private currentFilters(): AuditFiltersState {
    return {
      action: this.action,
      entity: this.entity,
      actor: this.actor,
      status: this.status,
      from: this.from,
      to: this.to,
    };
  }

  private persistPresets(presets: AuditPreset[]): void {
    this.presets = presets;
    auditPresetsStorage.write(presets);
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

function validateAuditPresets(value: unknown): AuditPreset[] | null {
  if (!Array.isArray(value)) return null;
  const presets: AuditPreset[] = [];
  for (const item of value) {
    if (presets.length >= PRESET_LIMIT) break;
    const preset = parseAuditPreset(item);
    if (preset !== null) presets.push(preset);
  }
  return presets;
}

function parseAuditPreset(value: unknown): AuditPreset | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id", PRESET_ID_LIMIT);
  const name = stringField(value, "name", PRESET_NAME_LIMIT);
  if (id === null || id.trim() === "" || name === null || name.trim() === "") return null;
  const filters = validateAuditFilters(value["filters"]);
  if (filters === null) return null;
  return { id, name, filters };
}

function createPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `preset-${Date.now().toString(36)}-${random}`;
}

function csvContent(entries: readonly AuditEntry[]): string {
  const lines = ["at,actor,action,entity,entity_id,status,ip,details"];
  for (const entry of entries) {
    lines.push(
      [
        csvCell(entry.at),
        csvCell(auditActor(entry)),
        csvCell(entry.action),
        csvCell(entry.entity),
        csvCell(entry.entity_id ?? ""),
        String(entry.status),
        csvCell(entry.ip ?? ""),
        csvCell(entry.details ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function downloadCsv(content: string): void {
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
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
