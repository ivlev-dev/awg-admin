import { computed, reactive, watch } from "@ivlev-dev/silent-core";

import { api, router, toasts } from "@/app/container";
import type { CidrPool, Group, InterfaceInfo, PoolMode } from "@/domain/types";
import { cidrContains, isCidr } from "@/domain/validation";

const POOL_MODE_BADGE: Record<PoolMode, string> = {
  auto: "badge badge--blue",
  rf_only: "badge badge--amber",
  external_only: "badge badge--violet",
};

const POOL_MODE_LABEL: Record<PoolMode, string> = {
  auto: "auto",
  rf_only: "rf_only",
  external_only: "external_only",
};

export class GroupDetailsVM {
  @reactive accessor group: Group | null = null;
  @reactive accessor pools: CidrPool[] = [];
  @reactive accessor interfaces: InterfaceInfo[] = [];
  @reactive accessor loading = true;
  @reactive accessor error: string | null = null;

  @reactive accessor formOpen = false;
  @reactive accessor formName = "";
  @reactive accessor formDescription = "";
  @reactive accessor formBaseCidr = "";
  @reactive accessor formForwarding = false;
  @reactive accessor formError: string | null = null;
  @reactive accessor formSaving = false;

  @reactive accessor poolOpen = false;
  @reactive accessor editingPool: CidrPool | null = null;
  @reactive accessor poolName = "";
  @reactive accessor poolCidr = "";
  @reactive accessor poolMode: PoolMode = "auto";
  @reactive accessor poolGateway = "";
  @reactive accessor poolEnabled = true;
  @reactive accessor poolError: string | null = null;
  @reactive accessor poolSaving = false;

  created(): void {
    void this.load();
  }

  @watch((vm: GroupDetailsVM) => vm.groupId)
  onGroupChange(): void {
    void this.load();
  }

  @computed
  get groupId(): string {
    return router.params.id ?? "";
  }

  @computed
  get title(): string {
    return this.group?.name ?? "Группа";
  }

  @computed
  get subtitle(): string {
    const description = this.group?.description.trim() ?? "";
    return description.length > 0 ? description : "Без описания";
  }

  @computed
  get baseCidr(): string {
    return this.group?.base_cidr ?? "—";
  }

  @computed
  get interfaceCount(): number {
    return this.group?.interfaces ?? 0;
  }

  @computed
  get deviceCount(): number {
    return this.group?.devices ?? 0;
  }

  @computed
  get forwardingDefault(): boolean {
    return this.group?.forwarding_default ?? false;
  }

  @computed
  get canSaveForm(): boolean {
    return !this.formSaving && this.formName.trim().length > 0 && this.formBaseCidr.trim().length > 0;
  }

  @computed
  get canSavePool(): boolean {
    return !this.poolSaving && this.poolName.trim().length > 0 && this.poolCidr.trim().length > 0;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    const id = this.groupId;
    if (!id) {
      this.group = null;
      this.pools = [];
      this.interfaces = [];
      this.loading = false;
      return;
    }
    try {
      const groups = await api.listGroups();
      const found = groups.find((item) => item.id === id) ?? null;
      if (!found) {
        this.group = null;
        this.pools = [];
        this.interfaces = [];
        return;
      }
      const [pools, interfaces] = await Promise.all([api.listPools(id), api.listInterfaces()]);
      this.group = found;
      this.pools = pools;
      this.interfaces = interfaces.filter((item) => item.group_id === id);
    } catch (error) {
      this.error = messageOf(error, "Не удалось загрузить группу");
      toasts.error(this.error);
    } finally {
      this.loading = false;
    }
  }

  back(): void {
    router.navigate("/groups");
  }

  openInterfaces(): void {
    router.navigate("/interfaces");
  }

  poolModeBadge(mode: PoolMode): string {
    return POOL_MODE_BADGE[mode];
  }

  poolModeLabel(mode: PoolMode): string {
    return POOL_MODE_LABEL[mode];
  }

  openForm(): void {
    const group = this.group;
    if (!group) return;
    this.formName = group.name;
    this.formDescription = group.description;
    this.formBaseCidr = group.base_cidr;
    this.formForwarding = group.forwarding_default;
    this.formError = null;
    this.formOpen = true;
  }

  closeForm(): void {
    if (this.formSaving) return;
    this.formOpen = false;
    this.formError = null;
  }

  setFormName(event: Event): void {
    this.formName = (event.target as HTMLInputElement).value;
  }

  setFormDescription(event: Event): void {
    this.formDescription = (event.target as HTMLTextAreaElement).value;
  }

  setFormBaseCidr(event: Event): void {
    this.formBaseCidr = (event.target as HTMLInputElement).value;
  }

  setFormForwarding(event: Event): void {
    this.formForwarding = (event.target as HTMLInputElement).checked;
  }

  async saveForm(event: Event): Promise<void> {
    event.preventDefault();
    if (this.formSaving) return;

    const name = this.formName.trim();
    const baseCidr = this.formBaseCidr.trim();
    if (!name) {
      this.formError = "Укажите название группы";
      return;
    }
    if (!isCidr(baseCidr)) {
      this.formError = "Базовая сеть должна быть в формате CIDR, например 10.8.0.0/16";
      return;
    }

    const id = this.groupId;
    if (!id) return;

    this.formSaving = true;
    this.formError = null;
    try {
      const updated = await api.updateGroup(id, {
        name,
        description: this.formDescription.trim(),
        base_cidr: baseCidr,
        forwarding_default: this.formForwarding,
      });
      this.group = updated;
      this.formOpen = false;
      toasts.success(`Группа «${name}» обновлена`);
    } catch (error) {
      this.formError = messageOf(error, "Не удалось сохранить группу");
      toasts.error(this.formError);
    } finally {
      this.formSaving = false;
    }
  }

  openPoolForm(pool?: CidrPool): void {
    if (pool) {
      this.editingPool = pool;
      this.poolName = pool.name;
      this.poolCidr = pool.cidr;
      this.poolMode = pool.mode;
      this.poolGateway = pool.gateway ?? "";
      this.poolEnabled = pool.enabled;
    } else {
      this.editingPool = null;
      this.poolName = "";
      this.poolCidr = "";
      this.poolMode = "auto";
      this.poolGateway = "";
      this.poolEnabled = true;
    }
    this.poolError = null;
    this.poolOpen = true;
  }

  closePool(): void {
    if (this.poolSaving) return;
    this.poolOpen = false;
    this.poolError = null;
  }

  setPoolName(event: Event): void {
    this.poolName = (event.target as HTMLInputElement).value;
  }

  setPoolCidr(event: Event): void {
    this.poolCidr = (event.target as HTMLInputElement).value;
  }

  setPoolMode(value: string): void {
    this.poolMode = value as PoolMode;
  }

  setPoolGateway(event: Event): void {
    this.poolGateway = (event.target as HTMLInputElement).value;
  }

  setPoolEnabled(event: Event): void {
    this.poolEnabled = (event.target as HTMLInputElement).checked;
  }

  async savePool(event: Event): Promise<void> {
    event.preventDefault();
    if (this.poolSaving) return;

    const name = this.poolName.trim();
    const cidr = this.poolCidr.trim();
    const gateway = this.poolGateway.trim();
    if (!name) {
      this.poolError = "Укажите название пула";
      return;
    }
    if (!isCidr(cidr)) {
      this.poolError = "CIDR должен быть в формате 10.8.0.0/24";
      return;
    }
    const base = this.group?.base_cidr ?? "";
    if (!base) {
      this.poolError = "Сначала задайте базовую сеть группы";
      return;
    }
    if (!cidrContains(base, cidr)) {
      this.poolError = `Диапазон должен находиться внутри базовой сети ${base}`;
      return;
    }

    const id = this.groupId;
    if (!id) return;

    this.poolSaving = true;
    this.poolError = null;
    try {
      if (this.editingPool) {
        await api.updatePool(this.editingPool.id, {
          name,
          mode: this.poolMode,
          gateway: gateway.length > 0 ? gateway : null,
          enabled: this.poolEnabled,
        });
        toasts.success(`Пул «${name}» обновлён`);
      } else {
        await api.createPool(id, {
          name,
          cidr,
          mode: this.poolMode,
          gateway: gateway.length > 0 ? gateway : null,
        });
        toasts.success(`Пул «${name}» создан`);
      }
      this.poolOpen = false;
      await this.loadPools();
    } catch (error) {
      this.poolError = messageOf(error, "Не удалось сохранить пул");
      toasts.error(this.poolError);
    } finally {
      this.poolSaving = false;
    }
  }

  async removePool(pool: CidrPool): Promise<void> {
    if (!window.confirm(`Удалить пул «${pool.name}»?`)) return;
    try {
      await api.deletePool(pool.id);
      toasts.success(`Пул «${pool.name}» удалён`);
      await this.loadPools();
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось удалить пул"));
    }
  }

  private async loadPools(): Promise<void> {
    try {
      this.pools = await api.listPools(this.groupId);
    } catch (error) {
      this.error = messageOf(error, "Не удалось обновить пулы");
      toasts.error(this.error);
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}
