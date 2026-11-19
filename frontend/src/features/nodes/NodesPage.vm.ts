import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { Session } from "@/app/session";
import { compareBoolean, compareText, nextSort, sortIndicator, type SortState } from "@/domain/table-sort";
import { ToastStore } from "@/app/toast";
import {
  formatCpuLoad,
  formatMetricsUpdated,
  formatNodeMemory,
  formatNodeMemoryPercent,
  formatTokenIssuedAt,
} from "@/application/nodes/metrics";
import type { NodesService } from "@/application/nodes/service";
import { userMessage } from "@/application/errors";
import type { NodeCreated, NodeRotated } from "@/domain/nodes/types";
import type { NodeInfo } from "@/domain/types";
import { copyText } from "@/domain/clipboard";
import { t } from "@/i18n";
import { formatDateTimeI18n, pluralI18n } from "@/i18n/format";

export class NodesPageVM extends ViewModel {
  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor loading = true;
  @reactive accessor busy = false;
  @reactive accessor error: string | null = null;

  @reactive accessor createOpen = false;
  @reactive accessor name = "";
  @reactive accessor formError: string | null = null;

  @reactive accessor createdNode: NodeCreated | null = null;
  @reactive accessor tokenCopied = false;

  @reactive accessor rotatedNode: NodeRotated | null = null;
  @reactive accessor rotatedTokenCopied = false;
  @reactive accessor query = "";
  @reactive accessor statusFilter: "all" | "online" | "offline" = "all";
  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;
  @reactive accessor sort: SortState<"name" | "status"> | null = { key: "name", direction: "asc" };

  constructor(
    private readonly nodesService: NodesService,
    private readonly session: Session,
    private readonly toasts: ToastStore,
  ) {
    super();
  }

  override created(): void {
    void this.load();
  }

  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  @computed
  get filteredNodes(): NodeInfo[] {
    const query = this.query.trim().toLowerCase();
    const filtered = this.nodes.filter((node) => {
      if (this.statusFilter === "online" && !node.online) return false;
      if (this.statusFilter === "offline" && node.online) return false;
      if (query.length === 0) return true;
      return node.name.toLowerCase().includes(query) || node.id.toLowerCase().includes(query);
    });
    const sort = this.sort;
    if (sort === null) return filtered;
    const direction = sort.direction;
    return [...filtered].sort((left, right) => {
      if (sort.key === "name") return compareText(left.name, right.name, direction);
      return compareBoolean(left.online, right.online, direction);
    });
  }

  sortBy(key: "name" | "status"): void {
    this.sort = nextSort(this.sort, key);
  }

  sortMark(key: "name" | "status"): string {
    return sortIndicator(this.sort, key);
  }

  @computed
  get selectedCount(): number {
    return this.selectedIds.length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds = this.isSelected(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id];
  }

  get allFilteredSelected(): boolean {
    return this.filteredNodes.length > 0 && this.selectedIds.length === this.filteredNodes.length;
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allFilteredSelected ? [] : this.filteredNodes.map((node) => node.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  setQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
  }

  async bulkDelete(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    const confirmed = await askConfirm({
      title: t("nodes.bulk.delete.title"),
      message: t("bulk.confirm.delete", { count: ids.length }),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    this.bulkBusy = true;
    try {
      const result = await this.nodesService.bulk("delete", ids);
      const failed = result.failed.length;
      this.toasts[failed > 0 ? "error" : "success"](t("bulk.done", { done: result.done, failed }));
    } catch (error) {
      this.toasts.error(userMessage(error, t("nodes.error.delete")));
    } finally {
      this.bulkBusy = false;
      this.clearSelection();
      await this.load();
    }
  }

  @computed
  get online(): number {
    return this.nodes.filter((node) => node.online).length;
  }

  @computed
  get canCreate(): boolean {
    return this.name.trim().length > 0 && !this.busy;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const nodes = await this.nodesService.listNodes();
      this.nodes = [...nodes].sort(
        (left, right) => Number(right.online) - Number(left.online) || left.name.localeCompare(right.name),
      );
    } catch (error) {
      this.error = userMessage(error, t("nodes.error.load"));
    } finally {
      this.loading = false;
    }
  }

  openCreate(): void {
    this.createOpen = true;
    this.name = "";
    this.formError = null;
    this.tokenCopied = false;
  }

  closeCreate(): void {
    if (this.busy) return;
    this.createOpen = false;
    this.formError = null;
  }

  closeCreated(): void {
    this.createdNode = null;
    this.tokenCopied = false;
  }

  closeRotated(): void {
    this.rotatedNode = null;
    this.rotatedTokenCopied = false;
  }

  setName(event: Event): void {
    this.name = (event.target as HTMLInputElement).value;
  }

  async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canCreate) return;
    this.busy = true;
    this.formError = null;
    try {
      const result = await this.nodesService.createNode(this.name.trim());
      this.createdNode = result;
      this.createOpen = false;
      this.name = "";
      this.toasts.success(t("nodes.toast.created", { name: result.node.name }));
      await this.load();
    } catch (error) {
      const message = userMessage(error, t("nodes.error.create"));
      this.formError = message;
      this.toasts.error(message);
    } finally {
      this.busy = false;
    }
  }

  async copyToken(): Promise<void> {
    const token = this.createdNode?.token;
    if (!token) return;
    const copied = await copyText(token).then(() => true, () => false);
    this.tokenCopied = copied;
    if (copied) {
      this.toasts.success(t("nodes.toast.tokenCopied"));
    } else {
      this.toasts.error(t("nodes.toast.tokenCopyFailed"));
    }
  }

  async copyRotatedToken(): Promise<void> {
    const token = this.rotatedNode?.token;
    if (!token) return;
    const copied = await copyText(token).then(() => true, () => false);
    this.rotatedTokenCopied = copied;
    if (copied) {
      this.toasts.success(t("nodes.toast.tokenCopied"));
    } else {
      this.toasts.error(t("nodes.toast.tokenCopyFailed"));
    }
  }

  async rotate(node: NodeInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = await askConfirm({
      title: t("nodes.confirm.rotate.title"),
      message: t("nodes.confirm.rotate", { name: node.name }),
      confirmLabel: t("nodes.confirm.rotate.action"),
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      const result = await this.nodesService.rotateNode(node.id);
      this.rotatedNode = result;
      this.rotatedTokenCopied = false;
      this.toasts.success(t("nodes.toast.rotated", { name: result.node.name }));
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, t("nodes.error.rotate")));
    } finally {
      this.busy = false;
    }
  }

  async remove(node: NodeInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = await askConfirm({
      title: t("nodes.confirm.delete.title"),
      message: t("nodes.confirm.delete", { name: node.name }),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.nodesService.deleteNode(node.id);
      this.toasts.success(t("nodes.toast.deleted", { name: node.name }));
      await this.load();
    } catch (error) {
      this.toasts.error(userMessage(error, t("nodes.error.delete")));
    } finally {
      this.busy = false;
    }
  }

  lastSeen(value: string | null): string {
    return value ? formatDateTimeI18n(value) : t("nodes.lastSeen.never");
  }

  interfacesLabel(node: NodeInfo): string {
    return `${node.interfaces} ${pluralI18n(node.interfaces, "common.interfaces.one", "common.interfaces.few", "common.interfaces.many")}`;
  }

  cpuValue(node: NodeInfo): string {
    return formatCpuLoad(node.cpu_load);
  }

  memoryValue(node: NodeInfo): string {
    return formatNodeMemory(node.mem_used_bytes, node.mem_total_bytes);
  }

  metricsLabel(node: NodeInfo): string {
    const cpu = formatCpuLoad(node.cpu_load);
    const memory = formatNodeMemory(node.mem_used_bytes, node.mem_total_bytes);
    return `${t("nodes.metrics.cpu")} ${cpu} · ${t("nodes.metrics.ram")} ${memory}`;
  }

  memoryPercent(node: NodeInfo): string | null {
    return formatNodeMemoryPercent(node.mem_used_bytes, node.mem_total_bytes);
  }

  metricsUpdatedLabel(node: NodeInfo): string {
    return t("nodes.metrics.updated", { value: formatMetricsUpdated(node.metrics_at) });
  }

  workerVersionLabel(node: NodeInfo): string {
    return node.worker_version ?? node.version ?? t("nodes.metrics.unavailable");
  }

  kernelVersionLabel(node: NodeInfo): string {
    return node.kernel_version ?? t("nodes.metrics.unavailable");
  }

  tokenIssuedLabel(node: NodeInfo): string {
    return formatTokenIssuedAt(node.token_issued_at);
  }
}

