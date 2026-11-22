import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

import { askConfirm } from "@/app/confirm";
import { GROUPS_SECTION_ENABLED } from "@/app/features";
import { invalidate, lookupInterfaces, lookupNodes } from "@/app/lookups";
import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import { SelectionModel } from "@/app/table-controller";
import type { GroupsService } from "@/application/groups/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { NodesService } from "@/application/nodes/service";
import { userMessage } from "@/application/errors";
import type { InterfaceBulkAction } from "@/domain/interfaces/repository";
import type { InterfaceInput } from "@/domain/interfaces/types";
import type { Group, InterfaceInfo, NodeInfo } from "@/domain/types";
import { copyText } from "@/domain/clipboard";
import { t } from "@/i18n";
import { pluralI18n } from "@/i18n/format";
import {
  compareBoolean,
  compareNumber,
  compareText,
  nextSort,
  sortIndicator,
  type SortState,
} from "@/domain/table-sort";
import { InterfaceEditForm, InterfaceForm } from "./interface.form";

export type InterfacesSortKey = "name" | "group" | "node" | "endpoint" | "peers" | "status";

export class InterfacesPageVM extends ViewModel {
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor groups: Group[] = [];
  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor loading = true;
  @reactive accessor busy = false;
  @reactive accessor error: string | null = null;

  @reactive accessor search = "";
  @reactive accessor groupFilter = "";
  @reactive accessor nodeFilter = "";
  @reactive accessor sort: SortState<InterfacesSortKey> | null = { key: "group", direction: "asc" };

  @reactive accessor createOpen = false;
  @reactive accessor formError: string | null = null;

  readonly createForm = new InterfaceForm();
  readonly editForm = new InterfaceEditForm();

  @reactive accessor editing: InterfaceInfo | null = null;
  @reactive accessor editError: string | null = null;

  @reactive accessor rotated: InterfaceInfo | null = null;
  @reactive accessor rotatedCopied = false;

  private createSnapshot = "";
  private editSnapshot = "";

  constructor(
    private readonly interfacesService: InterfacesService,
    private readonly groupsService: GroupsService,
    private readonly nodesService: NodesService,
    private readonly session: Session,
    private readonly toasts: ToastStore,
  ) {
    super();
  }

  override created(): void {
    void this.load();
  }

  override unmounted(): void {
    this.disposeForms();
  }

  override dispose(): void {
    this.disposeForms();
    super.dispose();
  }

  private disposeForms(): void {
    this.createForm.dispose();
    this.editForm.dispose();
  }

  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  get groupFilterEnabled(): boolean {
    return GROUPS_SECTION_ENABLED;
  }

  get ownGroupId(): string | null {
    return this.session.user?.group_id ?? null;
  }

  @computed
  get visible(): InterfaceInfo[] {
    const query = this.search.trim().toLowerCase();
    const groupId = this.isAdmin ? this.activeGroupFilter : this.ownGroupId ?? "";
    const filtered = this.interfaces.filter((item) => {
      if (!this.isAdmin && (!this.ownGroupId || item.group_id !== this.ownGroupId)) return false;
      if (groupId && item.group_id !== groupId) return false;
      if (this.nodeFilter && item.node_id !== this.nodeFilter) return false;
      if (!query) return true;
      return item.name.toLowerCase().includes(query) || item.label.toLowerCase().includes(query);
    });
    return this.sorted(filtered);
  }

  sortBy(key: InterfacesSortKey): void {
    this.sort = nextSort(this.sort, key);
  }

  sortMark(key: InterfacesSortKey): string {
    return sortIndicator(this.sort, key);
  }

  private sorted(items: InterfaceInfo[]): InterfaceInfo[] {
    const sort = this.sort;
    if (sort === null) return items;
    const direction = sort.direction;
    const byName = (left: InterfaceInfo, right: InterfaceInfo): number => compareText(left.name, right.name, "asc");
    return [...items].sort((left, right) => {
      let result = 0;
      if (sort.key === "name") result = compareText(left.name, right.name, direction);
      else if (sort.key === "group") result = compareText(left.group_name, right.group_name, direction);
      else if (sort.key === "node") result = compareText(left.node_name, right.node_name, direction);
      else if (sort.key === "endpoint") result = compareText(left.endpoint_host, right.endpoint_host, direction);
      else if (sort.key === "peers") result = compareNumber(left.peers, right.peers, direction);
      else result = compareBoolean(left.enabled, right.enabled, direction);
      return result !== 0 ? result : byName(left, right);
    });
  }

  @computed
  get hasInterfaces(): boolean {
    return this.interfaces.length > 0;
  }

  @computed
  get filtersActive(): boolean {
    return (
      this.search.trim().length > 0 ||
      (this.groupFilterEnabled && this.groupFilter.length > 0) ||
      this.nodeFilter.length > 0
    );
  }

  @computed
  get canCreate(): boolean {
    return this.createForm.isReady && !this.busy;
  }

  @computed
  get canSaveEdit(): boolean {
    return this.editing !== null && this.editForm.isReady && !this.busy;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [interfaces, groups, nodes] = await Promise.all([
        lookupInterfaces(this.interfacesService),
        this.groupsService.listGroups(),
        lookupNodes(this.nodesService),
      ]);
      this.interfaces = interfaces;
      this.groups = groups;
      this.nodes = nodes;
      this.syncFilters();
    } catch (error) {
      this.error = userMessage(error, t("interfaces.error.load"));
    } finally {
      this.loading = false;
    }
  }

  setSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  setGroupFilter(value: string): void {
    if (!this.groupFilterEnabled) return;
    this.groupFilter = value;
  }

  setNodeFilter(value: string): void {
    this.nodeFilter = value;
  }

  resetFilters(): void {
    this.search = "";
    this.groupFilter = "";
    this.nodeFilter = "";
  }

  openCreate(): void {
    this.createForm.reset();
    this.formError = null;
    this.createForm.groupId = this.isAdmin
      ? this.groupFilter || this.groups[0]?.id || ""
      : this.ownGroupId ?? "";
    this.createForm.nodeId = this.nodeFilter || this.nodes[0]?.id || "";
    this.createSnapshot = this.formState();
    this.createOpen = true;
  }

  formState(): string {
    return JSON.stringify(this.createForm.values);
  }

  @computed
  get createDirty(): boolean {
    return this.createOpen && this.formState() !== this.createSnapshot;
  }

  async closeCreate(): Promise<void> {
    if (this.busy) return;
    if (this.createDirty) {
      const confirmed = await askConfirm({
        title: t("interfaces.create.discard.title"),
        message: t("interfaces.create.discard.message"),
        confirmLabel: t("interfaces.create.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.createOpen = false;
    this.formError = null;
  }

  async submitCreate(event: Event): Promise<void> {
    await this.createForm.onSubmit(async (form) => {
      this.busy = true;
      this.formError = null;
      const input: InterfaceInput = {
        group_id: form.groupId,
        node_id: form.nodeId,
        name: form.name.trim(),
        label: form.label.trim(),
        endpoint_host: form.endpointHost.trim(),
        endpoint_port: form.endpointPort,
        listen_port: form.listenPort,
        mtu: form.mtu,
      };
      try {
        const created = await this.interfacesService.createInterface(input);
        invalidate("interfaces", this.interfacesService);
        this.interfaces = [...this.interfaces, created];
        this.createOpen = false;
        this.createSnapshot = this.formState();
        this.toasts.success(t("interfaces.toast.created", { name: created.name }));
      } catch (error) {
        const message = userMessage(error, t("interfaces.error.create"));
        this.formError = message;
        this.toasts.error(message);
      } finally {
        this.busy = false;
      }
    })(event);
  }

  openEdit(item: InterfaceInfo): void {
    this.editForm.reset();
    this.editError = null;
    this.editForm.label = item.label;
    this.editForm.endpointHost = item.endpoint_host;
    this.editForm.endpointPort = item.endpoint_port;
    this.editForm.listenPort = item.listen_port;
    this.editForm.mtu = item.mtu;
    this.editForm.enabled = item.enabled;
    this.editSnapshot = this.editState();
    this.editing = item;
  }

  editState(): string {
    return JSON.stringify(this.editForm.values);
  }

  @computed
  get editDirty(): boolean {
    return this.editing !== null && this.editState() !== this.editSnapshot;
  }

  async closeEdit(): Promise<void> {
    if (this.busy) return;
    if (this.editDirty) {
      const confirmed = await askConfirm({
        title: t("interfaces.edit.discard.title"),
        message: t("interfaces.edit.discard.message"),
        confirmLabel: t("interfaces.edit.discard.action"),
        tone: "danger",
      });
      if (!confirmed) return;
    }
    this.editing = null;
    this.editError = null;
  }

  async submitEdit(event: Event): Promise<void> {
    await this.editForm.onSubmit(async (form) => {
      const current = this.editing;
      if (!current) return;
      this.busy = true;
      this.editError = null;
      try {
        const updated = await this.interfacesService.updateInterface(current.id, {
          label: form.label.trim(),
          endpoint_host: form.endpointHost.trim(),
          endpoint_port: form.endpointPort,
          listen_port: form.listenPort,
          mtu: form.mtu,
          enabled: form.enabled,
        });
        invalidate("interfaces", this.interfacesService);
        this.replace(updated);
        this.editSnapshot = this.editState();
        this.editing = null;
        this.toasts.success(t("interfaces.toast.updated", { name: updated.name }));
      } catch (error) {
        const message = userMessage(error, t("interfaces.error.update"));
        this.editError = message;
        this.toasts.error(message);
      } finally {
        this.busy = false;
      }
    })(event);
  }

  private readonly selection = new SelectionModel(() => this.visible);

  @reactive accessor bulkBusy = false;

  get selectedIds(): string[] {
    return this.selection.selectedIds;
  }

  set selectedIds(value: string[]) {
    this.selection.selectedIds = value;
  }

  @computed
  get selectedCount(): number {
    return this.selection.selectedCount;
  }

  isSelected(id: string): boolean {
    return this.selection.isSelected(id);
  }

  toggleSelected(id: string): void {
    this.selection.toggleSelected(id);
  }

  get allVisibleSelected(): boolean {
    return this.selection.allSelected;
  }

  toggleSelectAll(): void {
    this.selection.toggleSelectAll();
  }

  clearSelection(): void {
    this.selection.clearSelection();
  }

  async bulkSetEnabled(enabled: boolean): Promise<void> {
    const ids = this.selectedIds.filter((id) => {
      const item = this.interfaces.find((candidate) => candidate.id === id);
      return item !== undefined && item.enabled !== enabled;
    });
    if (ids.length === 0) return;
    await this.runBulk(enabled ? "enable" : "disable", ids);
  }

  async bulkDelete(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    const confirmed = await askConfirm({
      title: t("interfaces.bulk.delete.title"),
      message: t("bulk.confirm.delete", { count: ids.length }),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    await this.runBulk("delete", ids);
  }

  private async runBulk(action: InterfaceBulkAction, ids: readonly string[]): Promise<void> {
    this.bulkBusy = true;
    try {
      const result = await this.interfacesService.bulk(action, ids);
      invalidate("interfaces", this.interfacesService);
      const failed = result.failed.length;
      this.toasts[failed > 0 ? "error" : "success"](t("bulk.done", { done: result.done, failed }));
    } catch (error) {
      const fallback = action === "delete" ? t("interfaces.error.delete") : t("interfaces.error.update");
      this.toasts.error(userMessage(error, fallback));
    } finally {
      this.bulkBusy = false;
      this.clearSelection();
      await this.load();
    }
  }

  async rotate(item: InterfaceInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = await askConfirm({
      title: t("interfaces.confirm.rotate.title"),
      message: t("interfaces.confirm.rotate", { name: item.name }),
      confirmLabel: t("interfaces.confirm.rotate.action"),
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      const updated = await this.interfacesService.rotateInterface(item.id);
      invalidate("interfaces", this.interfacesService);
      this.replace(updated);
      this.rotated = updated;
      this.rotatedCopied = false;
      this.toasts.success(t("interfaces.toast.rotated"));
    } catch (error) {
      this.toasts.error(userMessage(error, t("interfaces.error.rotate")));
    } finally {
      this.busy = false;
    }
  }

  closeRotated(): void {
    this.rotated = null;
    this.rotatedCopied = false;
  }

  async copyRotatedPublicKey(): Promise<void> {
    const key = this.rotated?.public_key;
    if (!key) return;
    const copied = await copyText(key).then(() => true, () => false);
    this.rotatedCopied = copied;
    if (copied) {
      this.toasts.success(t("interfaces.copy.publicKeyCopied"));
    } else {
      this.toasts.error(t("interfaces.copy.keyFailed"));
    }
  }

  async remove(item: InterfaceInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = await askConfirm({
      title: t("interfaces.confirm.delete.title"),
      message: t("interfaces.confirm.delete", { name: item.name }),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.interfacesService.deleteInterface(item.id);
      invalidate("interfaces", this.interfacesService);
      this.interfaces = this.interfaces.filter((current) => current.id !== item.id);
      this.toasts.success(t("interfaces.toast.deleted", { name: item.name }));
    } catch (error) {
      this.toasts.error(userMessage(error, t("interfaces.error.delete")));
    } finally {
      this.busy = false;
    }
  }

  async copyPublicKey(item: InterfaceInfo): Promise<void> {
    const copied = await copyText(item.public_key).then(() => true, () => false);
    if (copied) {
      this.toasts.success(t("interfaces.copy.publicKeyCopied"));
    } else {
      this.toasts.error(t("interfaces.copy.keyFailed"));
    }
  }

  async copyEndpoint(item: InterfaceInfo): Promise<void> {
    const copied = await copyText(this.endpoint(item)).then(() => true, () => false);
    if (copied) {
      this.toasts.success(t("interfaces.copy.endpointCopied"));
    } else {
      this.toasts.error(t("interfaces.copy.endpointFailed"));
    }
  }

  endpoint(item: InterfaceInfo): string {
    const host = item.endpoint_host.includes(":") ? `[${item.endpoint_host}]` : item.endpoint_host;
    return `${host}:${item.endpoint_port}`;
  }

  peersLabel(item: InterfaceInfo): string {
    return `${item.peers} ${pluralI18n(item.peers, "common.peers.one", "common.peers.few", "common.peers.many")}`;
  }

  obfHeaders(item: InterfaceInfo): string {
    const { h1, h2, h3, h4 } = item.obf;
    return `H1 ${h1.lo}–${h1.hi} · H2 ${h2.lo}–${h2.hi} · H3 ${h3.lo}–${h3.hi} · H4 ${h4.lo}–${h4.hi}`;
  }

  obfSigned(item: InterfaceInfo): string {
    const { s1, s2, s3, s4 } = item.obf;
    return `S1 ${s1} · S2 ${s2} · S3 ${s3} · S4 ${s4}`;
  }

  private syncFilters(): void {
    if (!this.groupFilterEnabled || (this.groupFilter && !this.groups.some((group) => group.id === this.groupFilter))) {
      this.groupFilter = "";
    }
    if (this.nodeFilter && !this.nodes.some((node) => node.id === this.nodeFilter)) {
      this.nodeFilter = "";
    }
  }

  private get activeGroupFilter(): string {
    return this.groupFilterEnabled ? this.groupFilter : "";
  }

  private replace(item: InterfaceInfo): void {
    this.interfaces = this.interfaces.map((current) => (current.id === item.id ? item : current));
  }
}

