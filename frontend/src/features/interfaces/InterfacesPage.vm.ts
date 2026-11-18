import { computed, reactive } from "@ivlev-dev/silent-core";

import { Session } from "@/app/session";
import { ToastStore } from "@/app/toast";
import type { GroupsService } from "@/application/groups/service";
import type { InterfacesService } from "@/application/interfaces/service";
import type { NodesService } from "@/application/nodes/service";
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

const DEFAULT_ENDPOINT_PORT = "443";
const DEFAULT_LISTEN_PORT = "51820";
const DEFAULT_MTU = "1420";

export type InterfacesSortKey = "name" | "group" | "node" | "endpoint" | "peers" | "status";

export class InterfacesPageVM {
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
  @reactive accessor formGroupId = "";
  @reactive accessor formNodeId = "";
  @reactive accessor formName = "";
  @reactive accessor formLabel = "";
  @reactive accessor formEndpointHost = "";
  @reactive accessor formEndpointPort = DEFAULT_ENDPOINT_PORT;
  @reactive accessor formListenPort = DEFAULT_LISTEN_PORT;
  @reactive accessor formMtu = DEFAULT_MTU;
  @reactive accessor formError: string | null = null;

  @reactive accessor editing: InterfaceInfo | null = null;
  @reactive accessor editLabel = "";
  @reactive accessor editHost = "";
  @reactive accessor editEndpointPort = "";
  @reactive accessor editListenPort = "";
  @reactive accessor editMtu = "";
  @reactive accessor editEnabled = true;
  @reactive accessor editError: string | null = null;

  @reactive accessor rotated: InterfaceInfo | null = null;
  @reactive accessor rotatedCopied = false;

  constructor(
    private readonly interfacesService: InterfacesService,
    private readonly groupsService: GroupsService,
    private readonly nodesService: NodesService,
    private readonly session: Session,
    private readonly toasts: ToastStore,
  ) {}

  created(): void {
    void this.load();
  }

  get isAdmin(): boolean {
    return this.session.isAdmin;
  }

  get ownGroupId(): string | null {
    return this.session.user?.group_id ?? null;
  }

  @computed
  get visible(): InterfaceInfo[] {
    const query = this.search.trim().toLowerCase();
    const groupId = this.isAdmin ? this.groupFilter : this.ownGroupId ?? "";
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
    return this.search.trim().length > 0 || this.groupFilter.length > 0 || this.nodeFilter.length > 0;
  }

  @computed
  get canCreate(): boolean {
    return (
      this.formGroupId.length > 0 &&
      this.formNodeId.length > 0 &&
      this.formName.trim().length > 0 &&
      this.formEndpointHost.trim().length > 0 &&
      isPort(this.formEndpointPort) &&
      isPort(this.formListenPort) &&
      isMtu(this.formMtu) &&
      !this.busy
    );
  }

  @computed
  get canSaveEdit(): boolean {
    return (
      this.editing !== null &&
      this.editHost.trim().length > 0 &&
      isPort(this.editEndpointPort) &&
      isPort(this.editListenPort) &&
      isMtu(this.editMtu) &&
      !this.busy
    );
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [interfaces, groups, nodes] = await Promise.all([
        this.interfacesService.listInterfaces(),
        this.groupsService.listGroups(),
        this.nodesService.listNodes(),
      ]);
      this.interfaces = interfaces;
      this.groups = groups;
      this.nodes = nodes;
      this.syncFilters();
    } catch (error) {
      this.error = messageOf(error, t("interfaces.error.load"));
    } finally {
      this.loading = false;
    }
  }

  setSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  setGroupFilter(value: string): void {
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
    this.createOpen = true;
    this.formError = null;
    this.formGroupId = this.isAdmin
      ? this.groupFilter || this.groups[0]?.id || ""
      : this.ownGroupId ?? "";
    this.formNodeId = this.nodeFilter || this.nodes[0]?.id || "";
    this.formName = "";
    this.formLabel = "";
    this.formEndpointHost = "";
    this.formEndpointPort = DEFAULT_ENDPOINT_PORT;
    this.formListenPort = DEFAULT_LISTEN_PORT;
    this.formMtu = DEFAULT_MTU;
  }

  closeCreate(): void {
    if (this.busy) return;
    this.createOpen = false;
    this.formError = null;
  }

  setFormGroup(value: string): void {
    this.formGroupId = value;
  }

  setFormNode(value: string): void {
    this.formNodeId = value;
  }

  setFormName(event: Event): void {
    this.formName = (event.target as HTMLInputElement).value;
  }

  setFormLabel(event: Event): void {
    this.formLabel = (event.target as HTMLInputElement).value;
  }

  setFormEndpointHost(event: Event): void {
    this.formEndpointHost = (event.target as HTMLInputElement).value;
  }

  setFormEndpointPort(event: Event): void {
    this.formEndpointPort = (event.target as HTMLInputElement).value;
  }

  setFormListenPort(event: Event): void {
    this.formListenPort = (event.target as HTMLInputElement).value;
  }

  setFormMtu(event: Event): void {
    this.formMtu = (event.target as HTMLInputElement).value;
  }

  async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canCreate) return;
    this.busy = true;
    this.formError = null;
    const input: InterfaceInput = {
      group_id: this.formGroupId,
      node_id: this.formNodeId,
      name: this.formName.trim(),
      label: this.formLabel.trim(),
      endpoint_host: this.formEndpointHost.trim(),
      endpoint_port: Number(this.formEndpointPort),
      listen_port: Number(this.formListenPort),
      mtu: Number(this.formMtu),
    };
    try {
      const created = await this.interfacesService.createInterface(input);
      this.interfaces = [...this.interfaces, created];
      this.createOpen = false;
      this.toasts.success(t("interfaces.toast.created", { name: created.name }));
    } catch (error) {
      const message = messageOf(error, t("interfaces.error.create"));
      this.formError = message;
      this.toasts.error(message);
    } finally {
      this.busy = false;
    }
  }

  openEdit(item: InterfaceInfo): void {
    this.editing = item;
    this.editError = null;
    this.editLabel = item.label;
    this.editHost = item.endpoint_host;
    this.editEndpointPort = String(item.endpoint_port);
    this.editListenPort = String(item.listen_port);
    this.editMtu = String(item.mtu);
    this.editEnabled = item.enabled;
  }

  closeEdit(): void {
    if (this.busy) return;
    this.editing = null;
    this.editError = null;
  }

  setEditLabel(event: Event): void {
    this.editLabel = (event.target as HTMLInputElement).value;
  }

  setEditHost(event: Event): void {
    this.editHost = (event.target as HTMLInputElement).value;
  }

  setEditEndpointPort(event: Event): void {
    this.editEndpointPort = (event.target as HTMLInputElement).value;
  }

  setEditListenPort(event: Event): void {
    this.editListenPort = (event.target as HTMLInputElement).value;
  }

  setEditMtu(event: Event): void {
    this.editMtu = (event.target as HTMLInputElement).value;
  }

  setEditEnabled(event: Event): void {
    this.editEnabled = (event.target as HTMLInputElement).checked;
  }

  async submitEdit(event: Event): Promise<void> {
    event.preventDefault();
    const current = this.editing;
    if (!current || !this.canSaveEdit) return;
    this.busy = true;
    this.editError = null;
    try {
      const updated = await this.interfacesService.updateInterface(current.id, {
        label: this.editLabel.trim(),
        endpoint_host: this.editHost.trim(),
        endpoint_port: Number(this.editEndpointPort),
        listen_port: Number(this.editListenPort),
        mtu: Number(this.editMtu),
        enabled: this.editEnabled,
      });
      this.replace(updated);
      this.editing = null;
      this.toasts.success(t("interfaces.toast.updated", { name: updated.name }));
    } catch (error) {
      const message = messageOf(error, t("interfaces.error.update"));
      this.editError = message;
      this.toasts.error(message);
    } finally {
      this.busy = false;
    }
  }

  @reactive accessor selectedIds: string[] = [];
  @reactive accessor bulkBusy = false;

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

  get allVisibleSelected(): boolean {
    return this.visible.length > 0 && this.selectedIds.length === this.visible.length;
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allVisibleSelected ? [] : this.visible.map((item) => item.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }

  async bulkSetEnabled(enabled: boolean): Promise<void> {
    const targets = this.visible.filter(
      (item) => this.selectedIds.includes(item.id) && item.enabled !== enabled,
    );
    if (targets.length === 0) return;
    await this.runBulk(targets, (item) => this.interfacesService.updateInterface(item.id, { enabled }));
  }

  async bulkDelete(): Promise<void> {
    const targets = this.visible.filter((item) => this.selectedIds.includes(item.id));
    if (targets.length === 0) return;
    if (!window.confirm(t("bulk.confirm.delete", { count: targets.length }))) return;
    await this.runBulk(targets, (item) => this.interfacesService.deleteInterface(item.id));
  }

  private async runBulk(
    targets: InterfaceInfo[],
    action: (item: InterfaceInfo) => Promise<unknown>,
  ): Promise<void> {
    this.bulkBusy = true;
    let done = 0;
    let failed = 0;
    for (const item of targets) {
      try {
        await action(item);
        done += 1;
      } catch {
        failed += 1;
      }
    }
    this.bulkBusy = false;
    this.clearSelection();
    this.toasts[failed > 0 ? "error" : "success"](t("bulk.done", { done, failed }));
    await this.load();
  }

  async rotate(item: InterfaceInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = window.confirm(t("interfaces.confirm.rotate", { name: item.name }));
    if (!confirmed) return;
    this.busy = true;
    try {
      const updated = await this.interfacesService.rotateInterface(item.id);
      this.replace(updated);
      this.rotated = updated;
      this.rotatedCopied = false;
      this.toasts.success(t("interfaces.toast.rotated"));
    } catch (error) {
      this.toasts.error(messageOf(error, t("interfaces.error.rotate")));
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
    const confirmed = window.confirm(t("interfaces.confirm.delete", { name: item.name }));
    if (!confirmed) return;
    this.busy = true;
    try {
      await this.interfacesService.deleteInterface(item.id);
      this.interfaces = this.interfaces.filter((current) => current.id !== item.id);
      this.toasts.success(t("interfaces.toast.deleted", { name: item.name }));
    } catch (error) {
      this.toasts.error(messageOf(error, t("interfaces.error.delete")));
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
    if (this.groupFilter && !this.groups.some((group) => group.id === this.groupFilter)) {
      this.groupFilter = "";
    }
    if (this.nodeFilter && !this.nodes.some((node) => node.id === this.nodeFilter)) {
      this.nodeFilter = "";
    }
  }

  private replace(item: InterfaceInfo): void {
    this.interfaces = this.interfaces.map((current) => (current.id === item.id ? item : current));
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isPort(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const port = Number(value);
  return port >= 1 && port <= 65535;
}

function isMtu(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const mtu = Number(value);
  return mtu >= 576 && mtu <= 9000;
}

